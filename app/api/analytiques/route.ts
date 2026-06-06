import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toNum } from '@/lib/serial'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

// ── Zod : valide la période — fallback silencieux sur '6m' si valeur invalide ─
const periodeSchema = z.enum(['3m', '6m', '12m']).catch('6m')

// ── Cache serveur 1h — clé par userId+période ─────────────────────────────────
// Tag `analytiques-{userId}` → toutes les périodes d'un user invalidées d'un coup
// via POST /api/analytiques/invalidate → revalidateTag(`analytiques-${userId}`)
const getCachedData = (userId: string, periode: '3m' | '6m' | '12m') =>
  unstable_cache(
    async () => {
      const moisCount    = periode === '3m' ? 3 : periode === '12m' ? 12 : 6
      const anneeActuelle = new Date().getFullYear()
      const moisActuel   = new Date().getMonth() + 1         // 1–12
      const moisDebut    = Math.max(1, moisActuel - moisCount + 1)

      const anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId, annee: anneeActuelle } },
      })
      if (!anneeRec) return { barData: [], lineData: [], pieData: [] }

      const budgets = await prisma.budgetMensuel.findMany({
        where: {
          userId,
          anneeId: anneeRec.id,
          mois: { gte: moisDebut, lte: moisActuel },
          categorie: { isActive: true },
        },
        include: { categorie: true },
        orderBy: { mois: 'asc' },
      })

      // ─── 1. Bar chart — dépenses réelles par catégorie/mois ──────────────
      const barData = budgets
        .filter(b => !b.categorie.type.startsWith('revenu'))
        .map(b => ({
          mois:      MOIS_COURTS[b.mois],
          categorie: b.categorie.nom,
          depenses:  toNum(b.montantReel),
          budget:    toNum(b.montantAnticipe),
        }))

      // ─── 2. Line chart — % utilisation enveloppes actives ────────────────
      const lineData = budgets
        .filter(b => b.categorie.enveloppeActive && toNum(b.montantAnticipe) > 0)
        .map(b => ({
          mois:        MOIS_COURTS[b.mois],
          enveloppe:   b.categorie.nom,
          pourcentage: Math.round(
            (toNum(b.montantReel) / toNum(b.montantAnticipe)) * 100
          ),
        }))

      // ─── 3. Pie chart — répartition mois actuel ──────────────────────────
      const budgetActuel  = budgets.filter(b => b.mois === moisActuel)
      const totalAnticipe = budgetActuel
        .filter(b => !b.categorie.type.startsWith('revenu'))
        .reduce((acc, b) => acc + toNum(b.montantAnticipe), 0)

      const pieData = budgetActuel
        .filter(b => !b.categorie.type.startsWith('revenu') && toNum(b.montantAnticipe) > 0)
        .map(b => ({
          categorie:   b.categorie.nom,
          montant:     toNum(b.montantAnticipe),
          depenses:    toNum(b.montantReel),
          pourcentage: totalAnticipe > 0
            ? Math.round((toNum(b.montantAnticipe) / totalAnticipe) * 100)
            : 0,
        }))

      return { barData, lineData, pieData }
    },
    [`analytiques-${userId}-${periode}`],   // clé de cache unique par user + période
    {
      tags:       [`analytiques-${userId}`], // tag partagé → invalidation groupée
      revalidate: 3600,                      // 1h — fallback si invalidation non appelée
    }
  )()

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const userId   = session.user.id
    const rawPeriode = new URL(req.url).searchParams.get('periode')
    const periode  = periodeSchema.parse(rawPeriode) // fallback silencieux sur '6m'

    const data = await getCachedData(userId, periode)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[analytiques] GET:', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
