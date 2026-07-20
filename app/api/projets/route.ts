import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { serial } from '@/lib/serial'
import { sendPushToUser } from '@/lib/push'

// ── Schemas Zod ────────────────────────────────────────────────────────────────
const ProjetCreateSchema = z.object({
  nom: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  montantCible: z.number().int().positive(),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateCible: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categorieId: z.string().optional().nullable(),
  compteFondsId: z.string().optional().nullable(),
  notifSeuils: z.string().regex(/^(\d{1,3},?)+$/).default('50,75,100'),
})

const ProjetUpdateSchema = z.object({
  id: z.string().min(1),
  nom: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  montantCible: z.number().int().positive().optional(),
  montantActuel: z.number().int().min(0).optional(),
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateCible: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  statut: z.enum(['actif', 'atteint', 'abandonne']).optional(),
  categorieId: z.string().optional().nullable(),
  compteFondsId: z.string().optional().nullable(),
  notifSeuils: z.string().regex(/^(\d{1,3},?)+$/).optional(),
})

const VersementSchema = z.object({
  projetId: z.string().min(1),
  montant: z.number().int().positive(),
  categorieId: z.string().optional().nullable(),
  compteId: z.string().optional().nullable(),
})

// ── Serialisation BigInt ───────────────────────────────────────────────────────
function serializeProjet(p: any) {
  return {
    ...p,
    montantCible: serial(p.montantCible),
    montantActuel: serial(p.montantActuel),
    pourcentage: p.montantCible > BigInt(0)
      ? Math.min(100, Math.round((Number(p.montantActuel) / Number(p.montantCible)) * 100))
      : 0,
    enRetard: p.statut === 'actif' && new Date(p.dateCible) < new Date(),
    joursRestants: p.statut === 'actif'
      ? Math.max(0, Math.round((new Date(p.dateCible).getTime() - Date.now()) / 86400000))
      : null,
  }
}

// ── GET — Liste des projets ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const statut = searchParams.get('statut') // actif | atteint | abandonne | null = tous

    const projets = await prisma.projet.findMany({
      where: {
        userId: session.user.id,
        ...(statut ? { statut } : {}),
      },
      include: {
        categorie: { select: { id: true, nom: true } },
        compteFonds: { select: { id: true, nom: true } },
      },
      orderBy: [
        { statut: 'asc' },        // actif en premier
        { dateCible: 'asc' },     // puis par date cible croissante
        { createdAt: 'desc' },
      ],
    })

    // Tri : retard > bientot > actif > autres
    const sorted = projets
      .map(serializeProjet)
      .sort((a: any, b: any) => {
        if (a.enRetard && !b.enRetard) return -1
        if (!a.enRetard && b.enRetard) return 1
        if (a.statut === 'actif' && b.statut !== 'actif') return -1
        if (a.statut !== 'actif' && b.statut === 'actif') return 1
        return (a.joursRestants ?? 9999) - (b.joursRestants ?? 9999)
      })

    // Comptage badge retard
    const nbRetard = sorted.filter((p: any) => p.enRetard).length

    return NextResponse.json({ projets: sorted, nbRetard })
  } catch (e) {
    console.error('[GET /api/projets]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST — Creer un projet ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = ProjetCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data

  // Validation dates
  if (new Date(data.dateCible) < new Date(data.dateDebut)) {
    return NextResponse.json({ message: 'La date cible doit etre apres la date de debut' }, { status: 422 })
  }

  try {
    const projet = await prisma.projet.create({
      data: {
        userId: session.user.id,
        nom: data.nom,
        description: data.description ?? null,
        montantCible: BigInt(data.montantCible),
        montantActuel: BigInt(0),
        dateDebut: new Date(data.dateDebut),
        dateCible: new Date(data.dateCible),
        statut: 'actif',
        compteFondsId: data.compteFondsId ?? null,
        notifSeuils: data.notifSeuils,
      },
      include: {
        categorie: { select: { id: true, nom: true } },
        compteFonds: { select: { id: true, nom: true } },
      },
    })

    await logAudit({
      userId: session.user.id,
      action: 'create',
      entityType: 'projet',
      entityId: projet.id,
      details: { nom: data.nom, montantCible: data.montantCible },
      req,
    })

    return NextResponse.json({ projet: serializeProjet(projet) }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/projets]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PUT — Mettre a jour un projet (inclut versement) ──────────────────────────
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  // Versement special
  if (body._action === 'versement') {
    const parsed = VersementSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ message: 'Donnees versement invalides' }, { status: 422 })
    }
    return handleVersement(session.user.id, parsed.data, req)
  }

  const parsed = ProjetUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides', errors: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data

  // Verifier appartenance
  const existing = await prisma.projet.findUnique({
    where: { id: data.id },
  })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ message: 'Projet introuvable' }, { status: 404 })
  }

  try {
    const updated = await prisma.projet.update({
      where: { id: data.id },
      data: {
        ...(data.nom !== undefined ? { nom: data.nom } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.montantCible !== undefined ? { montantCible: BigInt(data.montantCible) } : {}),
        ...(data.montantActuel !== undefined ? { montantActuel: BigInt(data.montantActuel) } : {}),
        ...(data.dateDebut !== undefined ? { dateDebut: new Date(data.dateDebut) } : {}),
        ...(data.dateCible !== undefined ? { dateCible: new Date(data.dateCible) } : {}),
        ...(data.statut !== undefined ? { statut: data.statut } : {}),
        ...(data.categorieId !== undefined ? { categorieId: data.categorieId } : {}),
        ...(data.compteFondsId !== undefined ? { compteFondsId: data.compteFondsId } : {}),
        ...(data.notifSeuils !== undefined ? { notifSeuils: data.notifSeuils } : {}),
      },
      include: {
        categorie: { select: { id: true, nom: true } },
        compteFonds: { select: { id: true, nom: true } },
      },
    })

    await logAudit({
      userId: session.user.id,
      action: 'update',
      entityType: 'projet',
      entityId: data.id,
      details: data,
      req,
    })

    return NextResponse.json({ projet: serializeProjet(updated) })
  } catch (e) {
    console.error('[PUT /api/projets]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE — Supprimer un projet ───────────────────────────────────────────────
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

  const existing = await prisma.projet.findUnique({ where: { id } })
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ message: 'Projet introuvable' }, { status: 404 })
  }

  try {
    await prisma.projet.delete({ where: { id } })

    await logAudit({
      userId: session.user.id,
      action: 'delete',
      entityType: 'projet',
      entityId: id,
      details: { nom: existing.nom },
      req,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/projets]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── Handler versement ─────────────────────────────────────────────────────────
async function handleVersement(
  userId: string,
  data: z.infer<typeof VersementSchema>,
  req: NextRequest
): Promise<NextResponse> {
  const projet = await prisma.projet.findUnique({ where: { id: data.projetId } })
  if (!projet || projet.userId !== userId) {
    return NextResponse.json({ message: 'Projet introuvable' }, { status: 404 })
  }
  if (projet.statut !== 'actif') {
    return NextResponse.json({ message: 'Ce projet n\'est plus actif' }, { status: 422 })
  }

  const ancienMontant = Number(projet.montantActuel)
  const cible = Number(projet.montantCible)
  const nouveau = ancienMontant + data.montant
  const ancienPct = cible > 0 ? Math.round((ancienMontant / cible) * 100) : 0
  const nouveauPct = cible > 0 ? Math.round((nouveau / cible) * 100) : 0

  try {
    // Transaction : mise a jour projet + creation decaissement lie
    const [updatedProjet] = await prisma.$transaction([
      prisma.projet.update({
        where: { id: data.projetId },
        data: {
          montantActuel: BigInt(nouveau),
          statut: nouveau >= cible ? 'atteint' : 'actif',
        },
        include: {
          categorie: { select: { id: true, nom: true } },
          compteFonds: { select: { id: true, nom: true } },
        },
      }),
      // Decaissement lie au versement
      prisma.decaissement.create({
        data: {
          userId,
                    description: `Versement projet : ${projet.nom}`,
          dateOperation: new Date(),
          montantTotal: BigInt(data.montant),
          sourceVocale: false,
        },
      }),
    ])

    await logAudit({
      userId,
      action: 'create',
      entityType: 'projet',
      entityId: data.projetId,
      details: { montant: data.montant, ancienPct, nouveauPct },
      req,
    })

    // Notifications seuils (50, 75, 100)
    const seuils = (projet.notifSeuils ?? '50,75,100')
      .split(',')
      .map(Number)
      .filter(Boolean)

    for (const seuil of seuils) {
      if (ancienPct < seuil && nouveauPct >= seuil) {
        const msg = seuil === 100
          ? `🎯 Objectif "${projet.nom}" atteint !`
          : `📈 Projet "${projet.nom}" : ${seuil}% atteint`
        await sendPushToUser(userId, {
          title: 'GestBudget — Projet',
          body: msg,
          icon: '/icons/icon-192x192.png',
        }).catch(() => {})
      }
    }

    return NextResponse.json({ projet: serializeProjet(updatedProjet) })
  } catch (e) {
    console.error('[VERSEMENT /api/projets]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
