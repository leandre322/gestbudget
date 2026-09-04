import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'

// ─────────────────────────────────────────────────────────────────────────────
// S10 / F5b — Pointage des paiements recurrents
//
// Table recurrentes_paiements, DELIBEREMENT decouplee de recurrentes_executions.
// Cette route n'ecrit JAMAIS dans budget_mensuel ni dans recurrentes_executions :
// recurrentes_executions est la garde d'idempotence du cron mensuel, y ecrire
// depuis l'UI supprimerait silencieusement les generations futures.
//
// Modele : un pointage est un ETAT, pas un journal.
//   POST   = pointer   (upsert logique, idempotent)
//   DELETE = depointer (suppression de la ligne — decision S10)
// La trace historique vit dans AuditLog, pas ici.
// ─────────────────────────────────────────────────────────────────────────────

// Periode stricte. Le regex /^\d{4}-\d{2}$/ utilise ailleurs accepte 2026-00 et
// 2026-99 : on borne reellement le mois ici.
const PERIODE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

// Bornes anti-saisie absurde. La borne haute autorise le mois suivant : payer
// une echeance en avance est un cas legitime. Elargir = modifier MOIS_AVANCE_MAX.
const ANNEE_MIN = 2020
const MOIS_AVANCE_MAX = 1

const PeriodeSchema = z.string().regex(PERIODE_REGEX, 'Periode invalide (format YYYY-MM)')

const PointerSchema = z.object({
  recurrenteId: z.string().min(1),
  periode: PeriodeSchema,
})

// Convertit "YYYY-MM" en rang absolu de mois, pour comparer sans manipuler de Date.
function rangMois(periode: string): number {
  const annee = Number(periode.slice(0, 4))
  const mois = Number(periode.slice(5, 7))
  return annee * 12 + (mois - 1)
}

// Retourne un message d'erreur, ou null si la periode est acceptable.
function verifierBornes(periode: string, maintenant: Date): string | null {
  if (Number(periode.slice(0, 4)) < ANNEE_MIN) {
    return `Periode anterieure a ${ANNEE_MIN}`
  }
  const rangCourant = maintenant.getFullYear() * 12 + maintenant.getMonth()
  if (rangMois(periode) > rangCourant + MOIS_AVANCE_MAX) {
    return 'Periode trop lointaine dans le futur'
  }
  return null
}

// ── GET — Paiements pointes d'une periode ────────────────────────────────────
// Retourne uniquement les identifiants et la date de pointage : aucune donnee
// de montant ne transite ici, le front les a deja via /api/recurrentes.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const periode = searchParams.get('periode') ?? ''

  const parsed = PeriodeSchema.safeParse(periode)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Periode invalide' }, { status: 422 })
  }

  try {
    // Requete servie par recurrentes_paiements_user_periode_idx.
    const paiements = await prisma.recurrentePaiement.findMany({
      where: { userId: session.user.id, periode },
      select: { recurrenteId: true, payeAt: true },
    })

    return NextResponse.json({ periode, paiements })
  } catch (e) {
    console.error('[GET /api/recurrentes/paiements]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST — Pointer un paiement ───────────────────────────────────────────────
// Idempotent : un double clic renvoie 200 avec deja=true, jamais une erreur.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 })
  }

  const parsed = PointerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Donnees invalides', errors: parsed.error.flatten() },
      { status: 422 }
    )
  }
  const { recurrenteId, periode } = parsed.data

  const borne = verifierBornes(periode, new Date())
  if (borne) return NextResponse.json({ message: borne }, { status: 422 })

  try {
    // Securite : la recurrente doit appartenir a l'utilisateur. Le userId ecrit
    // en base vient de la SESSION, jamais du corps de la requete.
    const recurrente = await prisma.recurrente.findUnique({
      where: { id: recurrenteId },
      select: { id: true, userId: true, libelle: true },
    })
    if (!recurrente || recurrente.userId !== session.user.id) {
      return NextResponse.json({ message: 'Recurrente introuvable' }, { status: 404 })
    }

    try {
      const paiement = await prisma.recurrentePaiement.create({
        data: { recurrenteId, userId: session.user.id, periode },
        select: { recurrenteId: true, periode: true, payeAt: true },
      })

      await logAudit({
        userId: session.user.id,
        action: 'create',
        entityType: 'recurrente_paiement',
        entityId: recurrenteId,
        entityNom: recurrente.libelle,
        details: { periode },
        req,
      })

      return NextResponse.json({ ok: true, deja: false, paiement }, { status: 201 })
    } catch (e: any) {
      // P2002 sur recurrentes_paiements_unique : deja pointe. Ce n'est pas une
      // erreur fonctionnelle, l'etat voulu par l'utilisateur est atteint.
      if (e?.code === 'P2002') {
        const existant = await prisma.recurrentePaiement.findFirst({
          where: { recurrenteId, periode, userId: session.user.id },
          select: { recurrenteId: true, periode: true, payeAt: true },
        })
        return NextResponse.json({ ok: true, deja: true, paiement: existant })
      }
      throw e
    }
  } catch (e) {
    console.error('[POST /api/recurrentes/paiements]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE — Depointer un paiement ───────────────────────────────────────────
// Suppression de la ligne (decision S10). La trace reste dans AuditLog.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const recurrenteId = searchParams.get('recurrenteId') ?? ''
  const periode = searchParams.get('periode') ?? ''

  if (!recurrenteId) {
    return NextResponse.json({ message: 'recurrenteId manquant' }, { status: 400 })
  }
  const parsed = PeriodeSchema.safeParse(periode)
  if (!parsed.success) {
    return NextResponse.json({ message: 'Periode invalide' }, { status: 422 })
  }

  try {
    // deleteMany scope par userId : un identifiant devine appartenant a un autre
    // compte ne supprime rien (aucune fuite d'existence, count = 0).
    const res = await prisma.recurrentePaiement.deleteMany({
      where: { recurrenteId, periode, userId: session.user.id },
    })

    if (res.count === 0) {
      return NextResponse.json({ message: 'Paiement introuvable' }, { status: 404 })
    }

    await logAudit({
      userId: session.user.id,
      action: 'delete',
      entityType: 'recurrente_paiement',
      entityId: recurrenteId,
      details: { periode },
      req,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/recurrentes/paiements]', e)
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 })
  }
}
