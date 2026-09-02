import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { toNum } from '@/lib/serial'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'

// =============================================================================
//  S7 / F9 — Comparaison annuelle N vs N-1
//  GET /api/analytiques/comparaison?annee=2026&mode=complet|ytd
//
//  Choix d'implementation :
//
//  1. Agregation en groupBy SQL (pas de filtrage JS sur les lignes chargees).
//     Deux annees = ~570 lignes aujourd'hui, mais la volumetrie croit d'environ
//     300 lignes par an.
//
//  2. Aucun filtre sur categorie.isActive. Une categorie desactivee cette annee
//     a bien eu des mouvements l'an dernier : l'exclure fausserait les totaux
//     annuels. Elle apparait avec le statut 'disparu'.
//
//  3. Appariement par categorieId. Le modele Categorie n'a pas d'anneeId : le
//     meme jeu de categories sert toutes les annees, l'appariement est donc
//     exact. Corollaire : renommer une categorie reecrit retroactivement son
//     libelle sur tout l'historique.
//
//  4. Tag de cache `analytiques-${userId}` reutilise : le bouton Rafraichir
//     existant (POST /api/analytiques/invalidate) invalide aussi cette route.
// =============================================================================

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

// ── Familles ────────────────────────────────────────────────────────────────
// TypeCategorie compte 8 valeurs. Les reduire a "depenses vs revenus" rangerait
// l'epargne et le remboursement de dette du cote des depenses : epargner
// 500 000 F apparaitrait comme une hausse de depenses. D'ou 4 familles.

export type FamilleCle = 'revenus' | 'depenses' | 'epargne' | 'dette'

const FAMILLE_PAR_TYPE: Record<string, FamilleCle> = {
  revenu:                 'revenus',
  depense_fixe:           'depenses',
  depense_variable:       'depenses',
  depense_occasionnelle:  'depenses',
  epargne_precaution:     'epargne',
  epargne_investissement: 'epargne',
  epargne_autre:          'epargne',
  remboursement_dette:    'dette',
}

// sens : comment interpreter une hausse.
//   positif -> hausse = favorable (revenus, epargne)
//   negatif -> hausse = defavorable (depenses)
//   neutre  -> pas de jugement (rembourser plus de dette n'est ni bon ni mauvais
//              dans l'absolu : plus de sortie de tresorerie, mais dette reduite)
const FAMILLES: { cle: FamilleCle; label: string; sens: 'positif' | 'negatif' | 'neutre' }[] = [
  { cle: 'revenus',  label: 'Revenus',   sens: 'positif' },
  { cle: 'depenses', label: 'Dépenses',  sens: 'negatif' },
  { cle: 'epargne',  label: 'Épargne',   sens: 'positif' },
  { cle: 'dette',    label: 'Dette',     sens: 'neutre'  },
]

const TYPES_DEPENSE = ['depense_fixe', 'depense_variable', 'depense_occasionnelle']

// ── Validation ──────────────────────────────────────────────────────────────
const querySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
  mode:  z.enum(['complet', 'ytd']).catch('complet'),
})

// Ecart relatif : null si la base est nulle (division par zero non signifiante).
const pct = (valeur: number, base: number): number | null => {
  if (base === 0) return null
  return ((valeur - base) / Math.abs(base)) * 100
}

const somme = (v: bigint | null | undefined): number => toNum(v ?? BigInt(0))

// ── Coeur ───────────────────────────────────────────────────────────────────
const getComparaison = (userId: string, annee: number, mode: 'complet' | 'ytd') =>
  unstable_cache(
    async () => {
      const anneeRef       = annee - 1
      const maintenant     = new Date()
      const anneeCourante  = maintenant.getFullYear()
      const moisCourant    = maintenant.getMonth() + 1
      const estAnneeEnCours = annee === anneeCourante

      // En mode YTD sur l'annee en cours, on tronque les DEUX annees au mois
      // courant. Sur une annee revolue, YTD et complet sont identiques.
      const moisMax = mode === 'ytd' && estAnneeEnCours ? moisCourant : 12

      // Annees disponibles (pour le selecteur cote client)
      const toutesAnnees = await prisma.annee.findMany({
        where:   { userId },
        select:  { annee: true },
        orderBy: { annee: 'desc' },
      })
      const anneesDisponibles = toutesAnnees.map(a => a.annee)

      const annees = await prisma.annee.findMany({
        where:  { userId, annee: { in: [annee, anneeRef] } },
        select: { id: true, annee: true },
      })

      const idN  = annees.find(a => a.annee === annee)?.id     ?? null
      const idN1 = annees.find(a => a.annee === anneeRef)?.id  ?? null

      const base = {
        annee,
        anneeRef,
        mode,
        moisMax,
        moisCourant,
        estAnneeEnCours,
        anneesDisponibles,
        disponible: { annee: !!idN, anneeRef: !!idN1 },
      }

      const anneeIds = [idN, idN1].filter((x): x is string => !!x)

      if (anneeIds.length === 0) {
        return { ...base, familles: [], mensuel: [], categories: [] }
      }

      // ── 1. Agregat par categorie et par annee ──────────────────────────
      const parCategorie = await prisma.budgetMensuel.groupBy({
        by:    ['anneeId', 'categorieId'],
        where: {
          userId,
          anneeId: { in: anneeIds },
          mois:    { gte: 1, lte: moisMax },
        },
        _sum: { montantReel: true, montantAnticipe: true },
      })

      // ── 2. Agregat mensuel des depenses (graphe 12 mois) ───────────────
      // Volontairement NON borne par moisMax : la troncature de l'annee en
      // cours doit rester visible a l'ecran.
      const parMois = await prisma.budgetMensuel.groupBy({
        by:    ['anneeId', 'mois'],
        where: {
          userId,
          anneeId:   { in: anneeIds },
          categorie: { type: { in: TYPES_DEPENSE as any } },
        },
        _sum: { montantReel: true },
      })

      // ── 3. Libelles et types des categories concernees ─────────────────
      const catIds = Array.from(new Set(parCategorie.map(g => g.categorieId)))
      const cats = catIds.length
        ? await prisma.categorie.findMany({
            where:  { id: { in: catIds } },
            select: { id: true, nom: true, type: true },
          })
        : []

      const catParId = new Map(cats.map(c => [c.id, c]))

      // ── Construction du tableau par categorie ──────────────────────────
      type LigneCat = {
        id: string
        nom: string
        type: string
        famille: FamilleCle
        reelN: number
        reelN1: number
        anticipeN: number
        anticipeN1: number
      }

      const lignes = new Map<string, LigneCat>()

      for (const g of parCategorie) {
        const cat = catParId.get(g.categorieId)
        if (!cat) continue

        const famille = FAMILLE_PAR_TYPE[cat.type] ?? 'depenses'

        if (!lignes.has(cat.id)) {
          lignes.set(cat.id, {
            id: cat.id, nom: cat.nom, type: cat.type, famille,
            reelN: 0, reelN1: 0, anticipeN: 0, anticipeN1: 0,
          })
        }

        const l    = lignes.get(cat.id)!
        const reel = somme(g._sum.montantReel)
        const anti = somme(g._sum.montantAnticipe)

        if (g.anneeId === idN)       { l.reelN  += reel; l.anticipeN  += anti }
        else if (g.anneeId === idN1) { l.reelN1 += reel; l.anticipeN1 += anti }
      }

      const categories = Array.from(lignes.values())
        .map(l => {
          const deltaAbs = l.reelN - l.reelN1
          // 'nouveau'  : rien en N-1, du mouvement en N
          // 'disparu'  : du mouvement en N-1, rien en N
          const statut: 'commun' | 'nouveau' | 'disparu' =
            l.reelN1 === 0 && l.reelN !== 0 ? 'nouveau'
          : l.reelN  === 0 && l.reelN1 !== 0 ? 'disparu'
          : 'commun'

          return {
            ...l,
            deltaAbs,
            deltaPct:         pct(l.reelN, l.reelN1),
            tauxRealisationN:  l.anticipeN  > 0 ? (l.reelN  / l.anticipeN)  * 100 : null,
            tauxRealisationN1: l.anticipeN1 > 0 ? (l.reelN1 / l.anticipeN1) * 100 : null,
            statut,
          }
        })
        // Tri par ecart absolu decroissant : la ou l'argent a bouge en premier
        .filter(l => l.reelN !== 0 || l.reelN1 !== 0 || l.anticipeN !== 0)
        .sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs))

      // ── Cartes par famille ─────────────────────────────────────────────
      const familles = FAMILLES.map(f => {
        const membres = categories.filter(c => c.famille === f.cle)

        const reelN      = membres.reduce((s, c) => s + c.reelN, 0)
        const reelN1     = membres.reduce((s, c) => s + c.reelN1, 0)
        const anticipeN  = membres.reduce((s, c) => s + c.anticipeN, 0)
        const anticipeN1 = membres.reduce((s, c) => s + c.anticipeN1, 0)

        return {
          cle:   f.cle,
          label: f.label,
          sens:  f.sens,
          reelN, reelN1, anticipeN, anticipeN1,
          deltaAbs: reelN - reelN1,
          deltaPct: pct(reelN, reelN1),
          tauxRealisationN:  anticipeN  > 0 ? (reelN  / anticipeN)  * 100 : null,
          tauxRealisationN1: anticipeN1 > 0 ? (reelN1 / anticipeN1) * 100 : null,
          nbCategories: membres.length,
        }
      })

      // ── Serie mensuelle (depenses) ─────────────────────────────────────
      const mensuel = Array.from({ length: 12 }, (_, i) => {
        const m   = i + 1
        const gN  = parMois.find(g => g.anneeId === idN  && g.mois === m)
        const gN1 = parMois.find(g => g.anneeId === idN1 && g.mois === m)

        // null (et non 0) pour les mois non encore ecoules de l'annee en cours :
        // Recharts interrompt la serie au lieu de tracer une chute a zero.
        const futur = estAnneeEnCours && m > moisCourant

        return {
          mois:    MOIS_COURTS[m],
          moisNum: m,
          reelN:   futur && !gN ? null : somme(gN?._sum.montantReel),
          reelN1:  somme(gN1?._sum.montantReel),
        }
      })

      return { ...base, familles, mensuel, categories }
    },
    [`comparaison-${userId}-${annee}-${mode}`],
    {
      tags:       [`analytiques-${userId}`],
      revalidate: 3600,
    }
  )()

// ── Handler ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const params = new URL(req.url).searchParams

    const parsed = querySchema.safeParse({
      annee: params.get('annee') ?? new Date().getFullYear(),
      mode:  params.get('mode')  ?? 'complet',
    })

    if (!parsed.success)
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })

    const data = await getComparaison(session.user.id, parsed.data.annee, parsed.data.mode)
    return NextResponse.json(data)
  } catch (err) {
    // Detail cote serveur uniquement — le client ne recoit rien de la structure DB
    console.error('[analytiques/comparaison] GET:', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
