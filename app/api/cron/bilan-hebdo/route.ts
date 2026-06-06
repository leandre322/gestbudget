import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"                        // ← sans destructuring
import { sendPushToUser } from "@/lib/webpush"           // ← nom corrigé

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 })

  try {
    const anneeActuelle = new Date().getFullYear()
    const moisActuel = new Date().getMonth() + 1

    const users = await prisma.user.findMany({
      where: { pushSubscriptions: { some: {} } },
      include: {
        projets: {
          where: {
            statut: "actif",
            dateCible: { lt: new Date() },
          },
        },
      },
    })

    let notifSent = 0

    for (const user of users) {
      // Récupérer l'année courante de l'user
      const anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId: user.id, annee: anneeActuelle } },
      })

      // Récupérer les budgets du mois
      const budgets = anneeRec
        ? await prisma.budgetMensuel.findMany({
            where: { userId: user.id, anneeId: anneeRec.id, mois: moisActuel },
            include: { categorie: true },
          })
        : []

      const projetsEnRetard = user.projets.length

      const totalAnticipe = budgets
        .filter(b => !b.categorie.type.startsWith("revenu"))
        .reduce((acc, b) => acc + Number(b.montantAnticipe ?? 0), 0)

      const totalReel = budgets
        .filter(b => !b.categorie.type.startsWith("revenu"))
        .reduce((acc, b) => acc + Number(b.montantReel ?? 0), 0)

      const pct = totalAnticipe > 0
        ? Math.round((totalReel / totalAnticipe) * 100)
        : 0

      const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢"
      const title = `${emoji} Bilan du lundi — ${pct}% utilisé`
      const parts = [`Budget : ${totalReel.toFixed(0)} / ${totalAnticipe.toFixed(0)} FCFA`]
      if (projetsEnRetard > 0) parts.push(`⏰ ${projetsEnRetard} projet(s) en retard`)

      await sendPushToUser(user.id, title, parts.join(" · "), "/analytiques")
      notifSent++
    }

    return NextResponse.json({
      ok: true,
      usersProcessed: users.length,
      notifSent,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[cron/bilan-hebdo]:", err)
    return NextResponse.json({ error: "Erreur cron" }, { status: 500 })
  }
}