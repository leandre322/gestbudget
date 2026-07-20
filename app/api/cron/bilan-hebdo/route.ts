import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import prisma from "@/lib/prisma"                        // ← sans destructuring
import { sendPushToUser } from "@/lib/webpush"

export const runtime = "nodejs"                          // requis : crypto + prisma (pas Edge)
export const maxDuration = 60

// ── Comparaison timing-safe du CRON_SECRET (anti timing-attack) ──────────────
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function GET(req: NextRequest) {
  // ── Auth cron ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? ""
  const secret = process.env.CRON_SECRET ?? ""
  if (!secret || !safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
  }

  const t0 = Date.now()

  try {
    // ── Purge des fenêtres de rate limiting expirées ───────────────────────────
    //    Isolée dans son propre try : un échec ne doit pas bloquer le bilan.
    let rateLimitsPurged = 0
    let purgeOk = true
    try {
      const r = await prisma.$executeRaw`DELETE FROM rate_limits WHERE reset_at < NOW()`
      rateLimitsPurged = Number(r)
    } catch (purgeErr) {
      purgeOk = false
      console.error("[cron/bilan-hebdo] purge rate_limits:", purgeErr)
    }

    // ── Bilan hebdomadaire (logique inchangée) ─────────────────────────────────
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

    // ── Log d'exécution (success, ou partial si la purge a échoué) ─────────────
    await prisma.cronLog.create({
      data: {
        jobName: "bilan-hebdo",
        status: purgeOk ? "success" : "partial",
        durationMs: Date.now() - t0,
        details: JSON.stringify({
          usersProcessed: users.length,
          notifSent,
          rateLimitsPurged,
          purgeOk,
        }),
      },
    }).catch(() => {}) // le log ne doit jamais faire échouer le cron

    return NextResponse.json({
      ok: true,
      usersProcessed: users.length,
      notifSent,
      rateLimitsPurged,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[cron/bilan-hebdo]:", err)

    // ── Log de l'échec avant de renvoyer le 500 ────────────────────────────────
    await prisma.cronLog.create({
      data: {
        jobName: "bilan-hebdo",
        status: "error",
        durationMs: Date.now() - t0,
        details: JSON.stringify({
          message: err instanceof Error ? err.message : String(err),
        }),
      },
    }).catch(() => {}) // si la DB est down, ne pas masquer l'erreur d'origine

    return NextResponse.json({ error: "Erreur cron" }, { status: 500 })
  }
}
