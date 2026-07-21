import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import { verifierSeuilsBudget } from '@/lib/alertes'
import { revalidateTag } from 'next/cache'
import { timingSafeEqual } from 'crypto'

export const dynamic = 'force-dynamic'

function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ── GET — Cron du 1er du mois (06:00 UTC) : génère les récurrentes actives ───
// Idempotence garantie par la contrainte unique (recurrenteId, periode) :
// un re-run produit des P2002 → comptés en "sautees", jamais de doublon.
// Date RÉELLE serveur (alignée avec /api/quick-add et le layout).
export async function GET(req: NextRequest) {
  const started = Date.now()

  // Auth cron : Bearer CRON_SECRET (comparaison temps constant)
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret || !auth.startsWith('Bearer ') || !safeCompare(auth.slice(7), secret)) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const now = new Date()
  const anneeNum = now.getFullYear()
  const mois = now.getMonth() + 1
  const periode = `${anneeNum}-${String(mois).padStart(2, '0')}`

  let generees = 0
  let sautees = 0
  let erreurs = 0

  try {
    const recurrentes = await prisma.recurrente.findMany({
      where: { isActive: true },
      include: { categorie: { select: { id: true, nom: true, isActive: true } } },
    })

    // Regroupement par user pour la notif récap + invalidation cache
    const parUser = new Map<string, { nb: number; total: number }>()

    for (const rec of recurrentes) {
      if (!rec.categorie?.isActive) { sautees++; continue }

      try {
        // Année de l'utilisateur (unique userId+annee)
        const annee = await prisma.annee.findUnique({
          where: { userId_annee: { userId: rec.userId, annee: anneeNum } },
        })
        if (!annee) { sautees++; continue } // année non créée → on ne force rien

        // Transaction : trace d'exécution (idempotence) + incrément budget
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

        // Alerte de seuil éventuelle (non bloquante)
        await verifierSeuilsBudget({
          userId: rec.userId, anneeId: annee.id, categorieId: rec.categorieId, mois,
        })
      } catch (e: any) {
        if (e?.code === 'P2002') {
          sautees++ // déjà générée pour cette période (idempotence) — normal si re-run
        } else {
          erreurs++
          console.error(`[cron recurrentes] recurrente ${rec.id}`, e)
        }
      }
    }

    // Invalidation cache analytiques + notif récap par utilisateur affecté
    const notifs = Array.from(parUser.entries()).map(([userId, agg]) => {
      revalidateTag(`analytiques-${userId}`) // S6 : aligné sur /api/budget
      return sendPushToUser(userId, {
        title: 'GestBudget — Recurrentes',
        body: `${agg.nb} operation(s) recurrente(s) generee(s) pour ${periode}`,
        url: '/suivi',
        tag: 'recurrentes-mensuelles',
      }).catch(() => {})
    })
    await Promise.allSettled(notifs)

    const status = erreurs > 0 ? (generees > 0 ? 'partial' : 'error') : 'success'
    await prisma.cronLog.create({
      data: {
        jobName: 'recurrentes-mensuelles',
        status,
        durationMs: Date.now() - started,
        details: JSON.stringify({ periode, generees, sautees, erreurs }),
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true, periode, generees, sautees, erreurs })
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
