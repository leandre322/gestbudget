import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { verifierSeuilsBudget } from '@/lib/alertes'
import { revalidateTag } from 'next/cache' // S6 : même invalidation que /api/budget

const QuickAddSchema = z.object({
  montant: z.number().int().positive(),
  categorieId: z.string().min(1),
  libelle: z.string().max(100).optional().nullable(),
})

// ── POST — Ajout rapide : incrémente montantReel du MOIS RÉEL COURANT ────────
// Décision S6 : date serveur (alignée avec le layout qui initialise sur new Date()
// et avec le cron des récurrentes) — jamais Parametres.moisCourant.
// Le client ne peut PAS choisir le mois → aucune falsification possible.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }
  const userId = session.user.id

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = QuickAddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }
  const { montant, categorieId, libelle } = parsed.data

  try {
    // Sécurité : catégorie appartenant à l'utilisateur et active
    const categorie = await prisma.categorie.findUnique({ where: { id: categorieId } })
    if (!categorie || categorie.userId !== userId || !categorie.isActive) {
      return NextResponse.json({ message: 'Categorie introuvable' }, { status: 404 })
    }

    // Mois réel courant (côté serveur)
    const now = new Date()
    const mois = now.getMonth() + 1
    const anneeNum = now.getFullYear()

    const annee = await prisma.annee.findUnique({
      where: { userId_annee: { userId, annee: anneeNum } },
    })
    if (!annee) {
      return NextResponse.json({ message: `Annee ${anneeNum} introuvable — ouvrez d'abord le suivi mensuel` }, { status: 422 })
    }

    // Upsert atomique : incrément de montantReel (jamais d'écrasement)
    const ligne = await prisma.budgetMensuel.upsert({
      where: {
        userId_anneeId_categorieId_mois: { userId, anneeId: annee.id, categorieId, mois },
      },
      create: {
        userId,
        anneeId: annee.id,
        categorieId,
        mois,
        montantAnticipe: BigInt(0),
        montantReel: BigInt(montant),
      },
      update: {
        montantReel: { increment: BigInt(montant) },
      },
    })

    await logAudit({
      userId,
      action: 'quick_add',
      entityType: 'budget_mensuel',
      entityId: ligne.id,
      entityNom: categorie.nom,
      details: { montant, mois, annee: anneeNum, libelle: libelle ?? null },
      req,
    })

    // S6 : invalide le cache analytiques (aligné sur PUT/POST /api/budget)
    revalidateTag(`analytiques-${userId}`)

    // Alerte de seuil éventuelle (non bloquante — voir lib/alertes.ts)
    await verifierSeuilsBudget({ userId, anneeId: annee.id, categorieId, mois })

    return NextResponse.json({
      ok: true,
      categorie: categorie.nom,
      montantReel: Number(ligne.montantReel),
      mois,
      annee: anneeNum,
    }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/quick-add]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
