import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { serial } from '@/lib/serial'

// ── Schemas Zod (synchronisés avec la colonne typeFlux — règle Zod+DB) ───────
const RecurrenteCreateSchema = z.object({
  libelle: z.string().min(1).max(100),
  montant: z.number().int().positive(),
  categorieId: z.string().min(1),
  typeFlux: z.enum(['decaissement', 'encaissement']).default('decaissement'),
})

const RecurrenteUpdateSchema = z.object({
  id: z.string().min(1),
  libelle: z.string().min(1).max(100).optional(),
  montant: z.number().int().positive().optional(),
  categorieId: z.string().min(1).optional(),
  typeFlux: z.enum(['decaissement', 'encaissement']).optional(),
  isActive: z.boolean().optional(),
})

// ── Sérialisation BigInt ─────────────────────────────────────────────────────
function serializeRecurrente(r: any) {
  return {
    ...r,
    montant: serial(r.montant),
  }
}

// ── GET — Liste des récurrentes (+ exécutions d'une période via ?periode) ────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const activesOnly = searchParams.get('actives') === '1'
    const periode = searchParams.get('periode') // "YYYY-MM" → badge 🔄 du suivi

    const recurrentes = await prisma.recurrente.findMany({
      where: {
        userId: session.user.id,
        ...(activesOnly ? { isActive: true } : {}),
      },
      include: {
        categorie: { select: { id: true, nom: true, type: true } },
      },
      orderBy: [{ isActive: 'desc' }, { montant: 'desc' }],
    })

    const totalMensuel = recurrentes
      .filter((r) => r.isActive)
      .reduce((acc, r) => acc + Number(r.montant), 0)

    // S6 : catégories effectivement alimentées par le cron pour cette période
    let executionsCategorieIds: string[] = []
    if (periode && /^\d{4}-\d{2}$/.test(periode)) {
      const execs = await prisma.recurrenteExecution.findMany({
        where: { userId: session.user.id, periode },
        select: { recurrente: { select: { categorieId: true } } },
      })
      executionsCategorieIds = Array.from(
        new Set(execs.map((e) => e.recurrente.categorieId))
      )
    }

    return NextResponse.json({
      recurrentes: recurrentes.map(serializeRecurrente),
      totalMensuel,
      executionsCategorieIds,
    })
  } catch (e) {
    console.error('[GET /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST — Créer une récurrente ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = RecurrenteCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }
  const data = parsed.data

  try {
    // Sécurité : la catégorie doit appartenir à l'utilisateur
    const categorie = await prisma.categorie.findUnique({ where: { id: data.categorieId } })
    if (!categorie || categorie.userId !== session.user.id) {
      return NextResponse.json({ message: 'Categorie introuvable' }, { status: 404 })
    }

    // Cohérence flux/catégorie : encaissement → revenu uniquement
    if (data.typeFlux === 'encaissement' && categorie.type !== 'revenu') {
      return NextResponse.json({ message: 'Un encaissement doit etre lie a une categorie de type revenu' }, { status: 422 })
    }
    if (data.typeFlux === 'decaissement' && categorie.type === 'revenu') {
      return NextResponse.json({ message: 'Un decaissement ne peut pas etre lie a une categorie revenu' }, { status: 422 })
    }

    const recurrente = await prisma.recurrente.create({
      data: {
        userId: session.user.id,
        categorieId: data.categorieId,
        libelle: data.libelle,
        montant: BigInt(data.montant),
        typeFlux: data.typeFlux,
      },
      include: { categorie: { select: { id: true, nom: true, type: true } } },
    })

    await logAudit({
      userId: session.user.id,
      action: 'create',
      entityType: 'recurrente',
      entityId: recurrente.id,
      entityNom: data.libelle,
      details: { montant: data.montant, typeFlux: data.typeFlux },
      req,
    })

    return NextResponse.json({ recurrente: serializeRecurrente(recurrente) }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PUT — Mettre à jour une récurrente ───────────────────────────────────────
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = RecurrenteUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }
  const data = parsed.data

  const existing = await prisma.recurrente.findUnique({ where: { id: data.id } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ message: 'Recurrente introuvable' }, { status: 404 })
  }

  try {
    // Si changement de catégorie : re-vérifier appartenance
    if (data.categorieId !== undefined) {
      const categorie = await prisma.categorie.findUnique({ where: { id: data.categorieId } })
      if (!categorie || categorie.userId !== session.user.id) {
        return NextResponse.json({ message: 'Categorie introuvable' }, { status: 404 })
      }
    }

    const updated = await prisma.recurrente.update({
      where: { id: data.id },
      data: {
        ...(data.libelle !== undefined ? { libelle: data.libelle } : {}),
        ...(data.montant !== undefined ? { montant: BigInt(data.montant) } : {}),
        ...(data.categorieId !== undefined ? { categorieId: data.categorieId } : {}),
        ...(data.typeFlux !== undefined ? { typeFlux: data.typeFlux } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      include: { categorie: { select: { id: true, nom: true, type: true } } },
    })

    await logAudit({
      userId: session.user.id,
      action: 'update',
      entityType: 'recurrente',
      entityId: data.id,
      details: { ...data },
      req,
    })

    return NextResponse.json({ recurrente: serializeRecurrente(updated) })
  } catch (e) {
    console.error('[PUT /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE — Supprimer une récurrente ────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ message: 'ID manquant' }, { status: 400 })
  }

  const existing = await prisma.recurrente.findUnique({ where: { id } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ message: 'Recurrente introuvable' }, { status: 404 })
  }

  try {
    await prisma.recurrente.delete({ where: { id } })

    await logAudit({
      userId: session.user.id,
      action: 'delete',
      entityType: 'recurrente',
      entityId: id,
      entityNom: existing.libelle,
      req,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
