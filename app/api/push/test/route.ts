import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import prisma from "@/lib/prisma"                 // ← sans destructuring
import { sendPushToUser } from "@/lib/webpush"

export const runtime = "nodejs"

export async function POST() {
  // ── Auth : seul l'utilisateur connecté peut se tester lui-même ──────────────
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 })
  }

  const userId = session.user.id

  // ── Vérifie qu'il existe au moins un abonnement (sinon rien n'est envoyé) ────
  const count = await prisma.pushSubscription.count({ where: { userId } })
  if (count === 0) {
    return NextResponse.json(
      { error: "Aucun abonnement push actif. Active d'abord les notifications." },
      { status: 400 },
    )
  }

  // ── Envoi immédiat ──────────────────────────────────────────────────────────
  await sendPushToUser(
    userId,
    "🔔 Test de notification",
    "Si tu vois ce message, les notifications push fonctionnent !",
    "/parametres",
  )

  return NextResponse.json({ ok: true, subscriptions: count })
}
