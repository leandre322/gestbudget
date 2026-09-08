import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { serial } from '@/lib/serial'

// ─────────────────────────────────────────────────────────────────────────────
// S20 — trois corrections.
//
// P107 — le GET ne renvoyait JAMAIS `paiements`, alors que recurrentes/page.tsx
//        fait `setPaiements(d.paiements ?? [])`. La vue « Echeances du mois »
//        perdait donc tous les pointages a chaque rechargement : cases vides,
//        compteur 0/n, statuts « Non pointe » sur des lignes reellement payees.
//        La donnee existait pourtant (recurrentes_paiements, route dediee).
//        Le GET la renvoie desormais quand ?periode est fourni — meme condition
//        que executionsCategorieIds, un pointage n'ayant de sens que relatif a
//        un mois. serial() est OBLIGATOIRE sur payeAt (Date), regle 22.
//
// P102 — DELETE etait une suppression DURE. La cascade emporte
//        recurrentes_executions, qui est la garde d'idempotence du cron
//        mensuel : supprimer puis recreer une recurrente autorise une SECONDE
//        generation sur une periode deja traitee, donc un double credit au
//        budget. Q156 ayant ecarte un `deletedAt`, on applique le motif de
//        DELETE /api/banques : on ne supprime reellement que ce qui n'a aucun
//        historique ; sinon on desactive, et la reponse dit lequel des deux a
//        eu lieu (`soft`, `nbExecutions`).
//
// P106 — POST et PUT verifiaient la PROPRIETE de la categorie, jamais son
//        activite. Une recurrente pointant sur une categorie desactivee fait
//        ecrire le cron dans une ligne hors perimetre (R3-b) : le montant
//        n'est lu ni par les KPI, ni par la repartition. Garde posee au POST,
//        et au PUT UNIQUEMENT quand la categorie est (re)designee — sinon on
//        interdirait de desactiver une recurrente dont la categorie a ete
//        desactivee entre-temps, precisement le cas qu'on veut pouvoir
//        traiter.
// ─────────────────────────────────────────────────────────────────────────────

// ── Schemas Zod (synchronisés avec les colonnes — règle Zod+DB) ──────────────
//
// S7 / F5 — Échéances :
//   jourEcheance     1..31, bornes IDENTIQUES à la contrainte CHECK Neon
//                    (recurrentes_jour_echeance_check). Toute évolution de ces
//                    bornes exige une migration dans la même session.
//   rappelActif      pas de contrainte en base
//   rappelJoursAvant borné 0..15 côté Zod uniquement (pas de CHECK en base)
//
// jourEcheance ne pilote PAS la génération : le cron mensuel continue de
// s'exécuter le 1er, l'idempotence (recurrenteId, periode) est préservée.
// Ces champs servent au calendrier et aux rappels.

const MONTANT_MAX = 999_999_999

const RecurrenteCreateSchema = z.object({
  libelle:          z.string().min(1).max(100),
  montant:          z.number().int().positive().max(MONTANT_MAX),
  categorieId:      z.string().min(1),
  typeFlux:         z.enum(['decaissement', 'encaissement']).default('decaissement'),
  jourEcheance:     z.number().int().min(1).max(31).nullish(),
  rappelActif:      z.boolean().optional().default(false),
  rappelJoursAvant: z.number().int().min(0).max(15).optional().default(3),
}).superRefine((v, ctx) => {
  // Un rappel sans date d'échéance n'a rien à déclencher
  if (v.rappelActif && (v.jourEcheance === null || v.jourEcheance === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['jourEcheance'],
      message: 'Un jour d\u2019échéance est requis pour activer le rappel',
    })
  }
})

const RecurrenteUpdateSchema = z.object({
  id:               z.string().min(1),
  libelle:          z.string().min(1).max(100).optional(),
  montant:          z.number().int().positive().max(MONTANT_MAX).optional(),
  categorieId:      z.string().min(1).optional(),
  typeFlux:         z.enum(['decaissement', 'encaissement']).optional(),
  isActive:         z.boolean().optional(),
  jourEcheance:     z.number().int().min(1).max(31).nullish(),
  rappelActif:      z.boolean().optional(),
  rappelJoursAvant: z.number().int().min(0).max(15).optional(),
})

// Message unique, pour que les deux gardes P106 ne divergent pas.
const MSG_CAT_INACTIVE =
  'Categorie desactivee : choisissez une categorie active'

// ── Sérialisation BigInt ─────────────────────────────────────────────────────
function serializeRecurrente(r: any) {
  return {
    ...r,
    montant: serial(r.montant),
  }
}

// ── Cohérence flux / type de catégorie ───────────────────────────────────────
// Factorisée : le POST la vérifiait, le PUT ne la vérifiait PAS (S7 FIX).
// On pouvait créer un décaissement valide puis le basculer en encaissement sur
// une catégorie de dépense — le cron aurait ensuite alimenté cette catégorie
// comme un revenu.
function verifierCoherence(typeFlux: string, typeCategorie: string): string | null {
  if (typeFlux === 'encaissement' && typeCategorie !== 'revenu')
    return 'Un encaissement doit etre lie a une categorie de type revenu'
  if (typeFlux === 'decaissement' && typeCategorie === 'revenu')
    return 'Un decaissement ne peut pas etre lie a une categorie revenu'
  return null
}

// ── GET — Liste des récurrentes (+ exécutions et pointages d'une période) ────
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

    // Note : agrégat brut, décaissements et encaissements confondus. Le front
    // (page /recurrentes, S7/F10) recalcule ses propres totaux par flux.
    const totalMensuel = recurrentes
      .filter((r) => r.isActive)
      .reduce((acc, r) => acc + Number(r.montant), 0)

    // S6 : catégories effectivement alimentées par le cron pour cette période
    // P107 : pointages de la période, attendus par la vue « Échéances ».
    let executionsCategorieIds: string[] = []
    let paiements: Array<{ recurrenteId: string; payeAt: any }> = []

    if (periode && /^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
      const [execs, pmts] = await Promise.all([
        prisma.recurrenteExecution.findMany({
          where: { userId: session.user.id, periode },
          select: { recurrente: { select: { categorieId: true } } },
        }),
        prisma.recurrentePaiement.findMany({
          where: { userId: session.user.id, periode },
          select: { recurrenteId: true, payeAt: true },
        }),
      ])

      executionsCategorieIds = Array.from(
        new Set(execs.map((e) => e.recurrente.categorieId))
      )
      // Règle 22 : payeAt est une Date, elle passe par serial().
      paiements = serial(pmts) as Array<{ recurrenteId: string; payeAt: any }>
    }

    return NextResponse.json({
      recurrentes: recurrentes.map(serializeRecurrente),
      totalMensuel,
      executionsCategorieIds,
      paiements,
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

    // P106 — une catégorie désactivée est hors périmètre (R3-b) : le cron y
    // écrirait un montant que ni les KPI ni la répartition ne lisent.
    if (!categorie.isActive) {
      return NextResponse.json({ message: MSG_CAT_INACTIVE }, { status: 422 })
    }

    const erreur = verifierCoherence(data.typeFlux, categorie.type)
    if (erreur) return NextResponse.json({ message: erreur }, { status: 422 })

    const recurrente = await prisma.recurrente.create({
      data: {
        userId:           session.user.id,
        categorieId:      data.categorieId,
        libelle:          data.libelle,
        montant:          BigInt(data.montant),
        typeFlux:         data.typeFlux,
        jourEcheance:     data.jourEcheance ?? null,
        rappelActif:      data.rappelActif,
        rappelJoursAvant: data.rappelJoursAvant,
      },
      include: { categorie: { select: { id: true, nom: true, type: true } } },
    })

    await logAudit({
      userId:     session.user.id,
      action:     'create',
      entityType: 'recurrente',
      entityId:   recurrente.id,
      entityNom:  data.libelle,
      details:    { montant: data.montant, typeFlux: data.typeFlux, jourEcheance: data.jourEcheance ?? null },
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
    // ── S7 FIX : cohérence revérifiée sur l'état RÉSULTANT ────────────────
    // Il faut confronter le typeFlux final à la catégorie finale, que l'un,
    // l'autre ou les deux soient modifiés.
    const categorieIdFinal = data.categorieId ?? existing.categorieId
    const typeFluxFinal    = data.typeFlux    ?? existing.typeFlux

    const categorie = await prisma.categorie.findUnique({ where: { id: categorieIdFinal } })
    if (!categorie || categorie.userId !== session.user.id) {
      return NextResponse.json({ message: 'Categorie introuvable' }, { status: 404 })
    }

    // P106 — garde posée UNIQUEMENT quand la catégorie est (re)désignée.
    // L'appliquer inconditionnellement interdirait de désactiver une
    // récurrente dont la catégorie a été désactivée entre-temps.
    if (data.categorieId !== undefined && !categorie.isActive) {
      return NextResponse.json({ message: MSG_CAT_INACTIVE }, { status: 422 })
    }

    const erreur = verifierCoherence(typeFluxFinal, categorie.type)
    if (erreur) return NextResponse.json({ message: erreur }, { status: 422 })

    // Un rappel ne peut rester actif sans échéance (création ET modification)
    const jourFinal = data.jourEcheance !== undefined
      ? data.jourEcheance
      : existing.jourEcheance
    const rappelFinal = data.rappelActif ?? existing.rappelActif

    if (rappelFinal && (jourFinal === null || jourFinal === undefined)) {
      return NextResponse.json(
        { message: 'Un jour d\u2019echeance est requis pour activer le rappel' },
        { status: 422 }
      )
    }

    const updated = await prisma.recurrente.update({
      where: { id: data.id },
      data: {
        ...(data.libelle          !== undefined ? { libelle:          data.libelle }            : {}),
        ...(data.montant          !== undefined ? { montant:          BigInt(data.montant) }    : {}),
        ...(data.categorieId      !== undefined ? { categorieId:      data.categorieId }        : {}),
        ...(data.typeFlux         !== undefined ? { typeFlux:         data.typeFlux }           : {}),
        ...(data.isActive         !== undefined ? { isActive:         data.isActive }           : {}),
        // nullish : `null` réinitialise l'échéance, `undefined` laisse en l'état
        ...(data.jourEcheance     !== undefined ? { jourEcheance:     data.jourEcheance ?? null }: {}),
        ...(data.rappelActif      !== undefined ? { rappelActif:      data.rappelActif }        : {}),
        ...(data.rappelJoursAvant !== undefined ? { rappelJoursAvant: data.rappelJoursAvant }   : {}),
      },
      include: { categorie: { select: { id: true, nom: true, type: true } } },
    })

    await logAudit({
      userId:     session.user.id,
      action:     'update',
      entityType: 'recurrente',
      entityId:   data.id,
      entityNom:  updated.libelle,
      details:    { ...data },
      req,
    })

    return NextResponse.json({ recurrente: serializeRecurrente(updated) })
  } catch (e) {
    console.error('[PUT /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE — Supprimer ou désactiver une récurrente (P102) ───────────────────
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
    // P102 — la suppression dure cascade sur recurrentes_executions, garde
    // d'idempotence du cron mensuel. Supprimer puis recréer autoriserait une
    // seconde génération sur une période déjà traitée. On ne supprime donc
    // réellement que ce qui n'a aucun historique.
    const nbExecutions = await prisma.recurrenteExecution.count({
      where: { userId: session.user.id, recurrenteId: id },
    })

    const soft = nbExecutions > 0

    if (soft) {
      await prisma.recurrente.update({
        where: { id },
        data:  { isActive: false },
      })
    } else {
      await prisma.recurrente.delete({ where: { id } })
    }

    await logAudit({
      userId:     session.user.id,
      action:     'delete',
      entityType: 'recurrente',
      entityId:   id,
      entityNom:  existing.libelle,
      details:    { soft, nbExecutions },
      req,
    })

    return NextResponse.json({ ok: true, soft, nbExecutions })
  } catch (e) {
    console.error('[DELETE /api/recurrentes]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
