import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import * as Sentry from '@sentry/nextjs'
import { sendPushToUser } from '@/lib/push'
import { verifierSeuilsBudget } from '@/lib/alertes'
import { revalidateTag } from 'next/cache'
import { timingSafeEqual } from 'crypto'
import { periodeMoisPrecedent, envoyerRapportsMensuels } from '@/lib/rapport-mensuel'

export const dynamic = 'force-dynamic'
// S8 : explicite (crypto + prisma + SMTP Brevo ne tournent pas sur Edge).
export const runtime = 'nodejs'
// S8 : l'envoi SMTP s'ajoute au budget temps — aligne sur bilan-hebdo.
export const maxDuration = 60

const JOB_NAME = 'recurrentes-mensuelles'

// S10 / P3 — budgets temps. Somme des plafonds < maxDuration, de sorte que
// la fermeture du CronLog soit TOUJOURS atteinte avant que Vercel ne tue la
// fonction. Sans cela, un SMTP Brevo qui pend fait disparaitre le run entier
// des logs (cause suspectee de C1 avant que le git log ne l'infirme).
const BUDGET_RAPPORTS_MS = 25000
const BUDGET_PUSH_MS = 10000
const BUDGET_SEUILS_MS = 10000

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// S10 / P2 — un echec d'observabilite ne doit jamais etre silencieux.
function signaler(contexte: string, e: unknown): void {
  console.error(`[cron ${JOB_NAME}] ${contexte}`, e)
  try {
    Sentry.captureException(e, { tags: { job: JOB_NAME }, extra: { contexte } })
  } catch {
    // Sentry indisponible : le console.error ci-dessus reste la trace.
  }
}

// S10 / P3 — plafonne une promesse. Ne l'annule pas (impossible en JS) mais
// rend la main a l'appelant avec une valeur de repli, ce qui permet de fermer
// le CronLog. Le travail en cours continue jusqu'a la fin de la lambda.
function avecBudget<T>(
  travail: Promise<T>,
  ms: number,
  etiquette: string,
  repli: T
): Promise<{ valeur: T; depasse: boolean }> {
  return new Promise((resolve) => {
    let regle = false
    const minuteur = setTimeout(() => {
      if (regle) return
      regle = true
      const msg = `budget temps depasse: ${etiquette} (${ms} ms)`
      console.error(`[cron ${JOB_NAME}] ${msg}`)
      try {
        Sentry.captureMessage(`${JOB_NAME}: ${msg}`, 'warning')
      } catch {
        // Sentry indisponible.
      }
      resolve({ valeur: repli, depasse: true })
    }, ms)

    travail
      .then((valeur) => {
        if (regle) return
        regle = true
        clearTimeout(minuteur)
        resolve({ valeur, depasse: false })
      })
      .catch((e) => {
        if (regle) return
        regle = true
        clearTimeout(minuteur)
        signaler(etiquette, e)
        resolve({ valeur: repli, depasse: false })
      })
  })
}

// S10 / P1 — CronLog en deux temps. Ouverture AVANT tout traitement : meme un
// crash brutal ou un timeout plateforme laisse une ligne 'running' orpheline,
// ce qui rend le silence d'un cron detectable (cf. P5, commit bilan-hebdo).
async function ouvrirLog(): Promise<string | null> {
  try {
    const ligne = await prisma.cronLog.create({
      data: {
        jobName: JOB_NAME,
        status: 'running',
        durationMs: 0,
        details: JSON.stringify({ phase: 'demarrage' }),
      },
    })
    return ligne.id
  } catch (e) {
    signaler('ouverture CronLog', e)
    return null
  }
}

async function fermerLog(
  logId: string | null,
  status: string,
  started: number,
  details: Record<string, unknown>
): Promise<void> {
  const durationMs = Date.now() - started
  const payload = JSON.stringify(details)
  try {
    if (logId) {
      await prisma.cronLog.update({
        where: { id: logId },
        data: { status, durationMs, details: payload },
      })
    } else {
      // L'ouverture a echoue : on tente au moins une trace terminale.
      await prisma.cronLog.create({
        data: { jobName: JOB_NAME, status, durationMs, details: payload },
      })
    }
  } catch (e) {
    signaler('fermeture CronLog', e)
  }
}

// ── GET — Cron du 1er du mois (06:00 UTC) ────────────────────────────────────
// 1. Genere les operations recurrentes actives de la periode courante.
// 2. S8 : envoie les rapports mensuels email (ex-/api/push/cron, fusionne ici).
// 3. S8 : une notification push UNIQUE par utilisateur (recurrentes + rappel
//    de saisie fusionnes), au lieu de deux notifications distinctes.
//
// Idempotence garantie par la contrainte unique (recurrenteId, periode) :
// un re-run produit des P2002 → comptes en "sautees", jamais de doublon.
// Date REELLE serveur (alignee avec /api/quick-add et le layout).
export async function GET(req: NextRequest) {
  const started = Date.now()

  // Auth cron : Bearer CRON_SECRET (comparaison temps constant).
  // Le middleware verifie deja ce secret en amont (S8/N5) — on conserve la
  // verification locale en defense en profondeur.
  // NB : le controle precede l'ouverture du CronLog, sinon un scan non
  // authentifie polluerait la table (et le rate limiting, cf. S9-C).
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || !auth.startsWith('Bearer ') || !safeCompare(auth.slice(7), secret)) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const logId = await ouvrirLog()

  const now = new Date()
  const anneeNum = now.getFullYear()
  const mois = now.getMonth() + 1
  const periode = `${anneeNum}-${String(mois).padStart(2, '0')}`

  // Periode du RAPPORT = mois precedent (celui qui vient de se terminer).
  const periodeRapport = periodeMoisPrecedent(now)
  const periodeRapportLabel = `${periodeRapport.annee}-${String(periodeRapport.mois).padStart(2, '0')}`

  let generees = 0
  let sautees = 0
  let erreurs = 0
  let degrade = false

  try {
    const recurrentes = await prisma.recurrente.findMany({
      where: { isActive: true },
      include: { categorie: { select: { id: true, nom: true, isActive: true } } },
    })

    // ── S10 / P4 : prechargement des annees ──────────────────────────────────
    // Avant : un findUnique par recurrente, soit N allers-retours Neon dans la
    // boucle. Desormais une seule requete, indexee sur la contrainte unique
    // (userId, annee) deja presente.
    const userIdsRecurrentes = Array.from(
      new Set(recurrentes.map((r: any) => r.userId as string))
    )
    const anneesRows = userIdsRecurrentes.length
      ? await prisma.annee.findMany({
          where: { annee: anneeNum, userId: { in: userIdsRecurrentes } },
          select: { id: true, userId: true },
        })
      : []
    const anneeParUser = new Map<string, string>(
      anneesRows.map((a: any) => [a.userId as string, a.id as string])
    )

    // Regroupement par user pour la notif recap + invalidation cache
    const parUser = new Map<string, { nb: number; total: number }>()

    // S10 / P4 : seuils dedupliques. Deux recurrentes sur la meme categorie
    // declenchaient deux verifications identiques, donc deux lectures de budget
    // et un risque de P2002 sur budget_alertes_unique.
    const seuils = new Map<
      string,
      { userId: string; anneeId: string; categorieId: string; mois: number }
    >()

    for (const rec of recurrentes) {
      if (!rec.categorie?.isActive) { sautees++; continue }

      const anneeId = anneeParUser.get(rec.userId)
      if (!anneeId) { sautees++; continue } // annee non creee → on ne force rien

      try {
        await prisma.$transaction([
          prisma.recurrenteExecution.create({
            data: {
              recurrenteId: rec.id,
              userId: rec.userId,
              periode,
              montant: rec.montant,
            },
          }),
          prisma.budgetMensuel.upsert({
            where: {
              userId_anneeId_categorieId_mois: {
                userId: rec.userId, anneeId, categorieId: rec.categorieId, mois,
              },
            },
            create: {
              userId: rec.userId,
              anneeId,
              categorieId: rec.categorieId,
              mois,
              montantAnticipe: BigInt(0),
              montantReel: rec.montant,
            },
            update: {
              montantReel: { increment: rec.montant },
            },
          }),
        ])

        generees++
        const agg = parUser.get(rec.userId) ?? { nb: 0, total: 0 }
        agg.nb++
        agg.total += Number(rec.montant) // Rule 22 : Number(bigint), jamais toString()
        parUser.set(rec.userId, agg)

        seuils.set(`${rec.userId}|${anneeId}|${rec.categorieId}|${mois}`, {
          userId: rec.userId, anneeId, categorieId: rec.categorieId, mois,
        })
      } catch (e: any) {
        if (e?.code === 'P2002') {
          sautees++ // deja generee pour cette periode (idempotence) — normal si re-run
        } else {
          erreurs++
          signaler(`recurrente ${rec.id}`, e)
        }
      }
    }

    // ── S10 / P4 : verification des seuils, hors boucle et parallelisee ──────
    // Les transactions sont toutes committees a ce stade : la lecture de budget
    // faite par verifierSeuilsBudget voit donc l'etat final, ce qui n'etait pas
    // garanti auparavant pour deux recurrentes de la meme categorie.
    const seuilsListe = Array.from(seuils.values())
    if (seuilsListe.length) {
      const resSeuils = await avecBudget(
        Promise.allSettled(
          seuilsListe.map((s) => verifierSeuilsBudget(s))
        ).then((res) => {
          for (const item of res) {
            if (item.status === 'rejected') signaler('verifierSeuilsBudget', item.reason)
          }
          return true
        }),
        BUDGET_SEUILS_MS,
        'seuils budget',
        false
      )
      if (resSeuils.depasse) degrade = true
    }

    // ── Invalidation cache analytiques (utilisateurs affectes uniquement) ─────
    const userIdsAffectes = Array.from(parUser.keys())
    for (let i = 0; i < userIdsAffectes.length; i++) {
      revalidateTag(`analytiques-${userIdsAffectes[i]}`) // S6 : aligne sur /api/budget
    }

    // ── S8 : rapports email (ex-/api/push/cron) ──────────────────────────────
    // Budget temps S10/P3 : un echec ou un blocage Brevo ne doit jamais faire
    // echouer la generation des recurrentes, deja committee en base a ce stade,
    // ni empecher la fermeture du CronLog.
    const repliRapports = { destinataires: 0, emailsEnvoyes: 0, erreurs: 0 }
    const resRapports = await avecBudget(
      envoyerRapportsMensuels(periodeRapport),
      BUDGET_RAPPORTS_MS,
      'envoi rapports mensuels',
      repliRapports
    )
    const rapports = resRapports.valeur
    if (resRapports.depasse) degrade = true

    // ── S8 : notification push UNIQUE et fusionnee ───────────────────────────
    // Avant : /api/push/cron notifiait TOUS les abonnes ("pensez a saisir"),
    // et cette route notifiait uniquement les utilisateurs ayant des
    // recurrentes. On garde les deux populations, en un seul message.
    let destinataires: string[] = []
    try {
      const abonnes = await prisma.pushSubscription.findMany({
        select: { userId: true },
        distinct: ['userId'],
      })
      destinataires = Array.from(
        new Set(
          Array.from(parUser.keys()).concat(abonnes.map((s: any) => s.userId as string))
        )
      )
    } catch (e) {
      signaler('lecture pushSubscription', e)
      degrade = true
      destinataires = Array.from(parUser.keys())
    }

    if (destinataires.length) {
      const envois = destinataires.map((userId) => {
        const agg = parUser.get(userId)
        const body = agg
          ? `${agg.nb} operation(s) recurrente(s) generee(s) pour ${periode}. Pensez a saisir votre suivi de ${periodeRapport.label}.`
          : `Pensez a saisir votre suivi de ${periodeRapport.label}.`

        return sendPushToUser(userId, {
          title: 'GestBudget - Recap mensuel',
          body,
          icon: '/icons/icon-192.png',
          url: '/suivi',
          tag: 'recap-mensuel',
        })
      })

      const resPush = await avecBudget(
        Promise.allSettled(envois).then((res) => {
          for (const item of res) {
            if (item.status === 'rejected') signaler('sendPushToUser', item.reason)
          }
          return true
        }),
        BUDGET_PUSH_MS,
        'notifications push',
        false
      )
      if (resPush.depasse) degrade = true
    }

    const status =
      erreurs > 0 ? (generees > 0 ? 'partial' : 'error') : degrade ? 'partial' : 'success'

    await fermerLog(logId, status, started, {
      periode,
      generees,
      sautees,
      erreurs,
      degrade,
      rapportPeriode: periodeRapportLabel,
      emailsEnvoyes: rapports.emailsEnvoyes,
      emailsErreurs: rapports.erreurs,
      pushNotifies: destinataires.length,
    })

    return NextResponse.json({
      ok: true,
      periode,
      generees,
      sautees,
      erreurs,
      degrade,
      emailsEnvoyes: rapports.emailsEnvoyes,
      pushNotifies: destinataires.length,
    })
  } catch (e) {
    signaler('erreur globale', e)
    await fermerLog(logId, 'error', started, {
      periode,
      generees,
      sautees,
      erreurs,
      erreurGlobale: true,
    })
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
