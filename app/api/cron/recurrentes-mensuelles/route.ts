import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
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

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
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
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || !auth.startsWith('Bearer ') || !safeCompare(auth.slice(7), secret)) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const now = new Date()
  const anneeNum = now.getFullYear()
  const mois = now.getMonth() + 1
  const periode = `${anneeNum}-${String(mois).padStart(2, '0')}`

  // Periode du RAPPORT = mois precedent (celui qui vient de se terminer).
  const periodeRapport = periodeMoisPrecedent(now)

  let generees = 0
  let sautees = 0
  let erreurs = 0

  try {
    const recurrentes = await prisma.recurrente.findMany({
      where: { isActive: true },
      include: { categorie: { select: { id: true, nom: true, isActive: true } } },
    })

    // Regroupement par user pour la notif recap + invalidation cache
    const parUser = new Map<string, { nb: number; total: number }>()

    for (const rec of recurrentes) {
      if (!rec.categorie?.isActive) { sautees++; continue }

      try {
        const annee = await prisma.annee.findUnique({
          where: { userId_annee: { userId: rec.userId, annee: anneeNum } },
        })
        if (!annee) { sautees++; continue } // annee non creee → on ne force rien

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
                userId: rec.userId, anneeId: annee.id, categorieId: rec.categorieId, mois,
              },
            },
            create: {
              userId: rec.userId,
              anneeId: annee.id,
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
        agg.total += Number(rec.montant)
        parUser.set(rec.userId, agg)

        await verifierSeuilsBudget({
          userId: rec.userId, anneeId: annee.id, categorieId: rec.categorieId, mois,
        })
      } catch (e: any) {
        if (e?.code === 'P2002') {
          sautees++ // deja generee pour cette periode (idempotence) — normal si re-run
        } else {
          erreurs++
          console.error(`[cron recurrentes] recurrente ${rec.id}`, e)
        }
      }
    }

    // ── Invalidation cache analytiques (utilisateurs affectes uniquement) ─────
    const userIdsAffectes = Array.from(parUser.keys())
    for (let i = 0; i < userIdsAffectes.length; i++) {
      revalidateTag(`analytiques-${userIdsAffectes[i]}`) // S6 : aligne sur /api/budget
    }

    // ── S8 : rapports email (ex-/api/push/cron) ──────────────────────────────
    // try/catch ISOLE : un echec Brevo ne doit jamais faire echouer la
    // generation des recurrentes, deja committee en base a ce stade.
    let rapports = { destinataires: 0, emailsEnvoyes: 0, erreurs: 0 }
    try {
      rapports = await envoyerRapportsMensuels(periodeRapport)
    } catch (e) {
      console.error('[cron recurrentes] envoi rapports mensuels', e)
      rapports.erreurs++
    }

    // ── S8 : notification push UNIQUE et fusionnee ───────────────────────────
    // Avant : /api/push/cron notifiait TOUS les abonnes ("pensez a saisir"),
    // et cette route notifiait uniquement les utilisateurs ayant des
    // recurrentes. On garde les deux populations, en un seul message.
    const abonnes = await prisma.pushSubscription.findMany({
      select: { userId: true },
      distinct: ['userId'],
    })

    const destinataires = Array.from(
      new Set(
        Array.from(parUser.keys()).concat(abonnes.map((s: any) => s.userId))
      )
    )

    const notifs = destinataires.map((userId) => {
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
      }).catch(() => {})
    })
    await Promise.allSettled(notifs)

    const status = erreurs > 0 ? (generees > 0 ? 'partial' : 'error') : 'success'
    await prisma.cronLog.create({
      data: {
        jobName: 'recurrentes-mensuelles',
        status,
        durationMs: Date.now() - started,
        details: JSON.stringify({
          periode,
          generees,
          sautees,
          erreurs,
          rapportPeriode: `${periodeRapport.annee}-${String(periodeRapport.mois).padStart(2, '0')}`,
          emailsEnvoyes: rapports.emailsEnvoyes,
          emailsErreurs: rapports.erreurs,
          pushNotifies: destinataires.length,
        }),
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      periode,
      generees,
      sautees,
      erreurs,
      emailsEnvoyes: rapports.emailsEnvoyes,
      pushNotifies: destinataires.length,
    })
  } catch (e) {
    console.error('[GET /api/cron/recurrentes-mensuelles]', e)
    await prisma.cronLog.create({
      data: {
        jobName: 'recurrentes-mensuelles',
        status: 'error',
        durationMs: Date.now() - started,
        details: 'Erreur globale',
      },
    }).catch(() => {})
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}