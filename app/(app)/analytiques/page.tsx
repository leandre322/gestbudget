"use client"
import { useState } from "react"
import dynamic from "next/dynamic"
import { useAnalytiques, type Periode } from "@/lib/hooks/useAnalytiques"
import { ChartSkeleton } from "@/components/analytics/ChartSkeleton"
import { BarChart2, TrendingUp, PieChart, Download, Loader2, RefreshCw, GitCompareArrows } from "lucide-react"

// ── Lazy loading Recharts ─────────────────────────────────────────────────────
// ssr: false OBLIGATOIRE — Recharts utilise SVG/DOM, n'existe pas côté serveur
// loading: affiche le skeleton correspondant pendant le chargement du bundle JS (~200kB)
const BarChartDepenses = dynamic(
  () => import('@/components/analytics/BarChartDepenses').then(m => m.BarChartDepenses),
  { ssr: false, loading: () => <ChartSkeleton type="bar" height={300} /> }
)
const LineChartEnveloppes = dynamic(
  () => import('@/components/analytics/LineChartEnveloppes').then(m => m.LineChartEnveloppes),
  { ssr: false, loading: () => <ChartSkeleton type="line" height={300} /> }
)
const PieChartBudget = dynamic(
  () => import('@/components/analytics/PieChartBudget').then(m => m.PieChartBudget),
  { ssr: false, loading: () => <ChartSkeleton type="pie" height={320} /> }
)

// ── S7 / F9 — Comparaison annuelle ────────────────────────────────────────────
// Chargé uniquement lorsque l'onglet est ouvert : ni la route, ni le bundle
// Recharts de ce composant ne sont sollicités tant qu'on reste sur Tendances.
const ComparaisonAnnuelle = dynamic(
  () => import('@/components/analytics/ComparaisonAnnuelle'),
  { ssr: false, loading: () => <ChartSkeleton type="bar" height={380} /> }
)

const PERIODES: { label: string; value: Periode }[] = [
  { label: "3 mois",  value: "3m"  },
  { label: "6 mois",  value: "6m"  },
  { label: "12 mois", value: "12m" },
]

type Onglet = "tendances" | "comparaison"

const ONGLETS: { cle: Onglet; label: string; Icone: typeof BarChart2 }[] = [
  { cle: "tendances",   label: "Tendances",   Icone: TrendingUp        },
  { cle: "comparaison", label: "Comparaison", Icone: GitCompareArrows  },
]

export default function AnalytiquesPage() {
  const [onglet,        setOnglet]        = useState<Onglet>("tendances")
  const [periode,       setPeriode]       = useState<Periode>("6m")
  const [exportLoading, setExportLoading] = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const { data, loading, error, refetch } = useAnalytiques(periode)

  // ── Rafraîchir : invalide le cache serveur (unstable_cache) puis refetch ───
  // Sans l'invalidation, le serveur retournerait les données cachées même après refetch
  const handleRefetch = async () => {
    setRefreshing(true)
    try {
      await fetch('/api/analytiques/invalidate', { method: 'POST' })
    } catch {
      // best-effort — on refetch quand même si l'invalidation échoue
    } finally {
      refetch()
      setRefreshing(false)
    }
  }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const annee = new Date().getFullYear()
      const mois  = new Date().getMonth() + 1
      const res   = await fetch(`/api/export/pdf?annee=${annee}&mois=${mois}`)
      if (!res.ok) throw new Error('Erreur export')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `GestBudget-${annee}-${String(mois).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[export/pdf]', e)
    } finally {
      setExportLoading(false)
    }
  }

  const estTendances = onglet === "tendances"

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytiques</h1>
          <p className="text-gray-400 text-sm mt-1">Visualisez vos tendances budgétaires</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Sélecteur période — propre à l'onglet Tendances */}
          {estTendances && (
            <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-1">
              {PERIODES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriode(p.value)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all font-medium ${
                    periode === p.value
                      ? "bg-indigo-600 text-white shadow"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Rafraîchir — invalide le cache serveur avant de refetch */}
          {estTendances && (
            <button
              onClick={handleRefetch}
              disabled={refreshing}
              className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white transition-all disabled:opacity-50"
              title="Rafraîchir (invalide le cache)"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* Export PDF */}
          <button
            onClick={handleExport}
            disabled={exportLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            Exporter PDF
          </button>
        </div>
      </div>

      {/* ── Onglets (S7 / F9) ──────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-800">
        {ONGLETS.map(({ cle, label, Icone }) => (
          <button
            key={cle}
            onClick={() => setOnglet(cle)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
              onglet === cle
                ? "border-indigo-500 text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            <Icone className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ══ ONGLET TENDANCES ═══════════════════════════════════════════════ */}
      {estTendances && (
        <>
          {/* ── Erreur ─────────────────────────────────────────────────────── */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
              <span>⚠️</span> {error}
            </div>
          )}

          {/* ── Chargement initial — skeletons typés en lieu et place des graphiques */}
          {loading && (
            <div className="space-y-6">
              <ChartSkeleton type="bar"  height={380} />
              <ChartSkeleton type="line" height={380} />
              <ChartSkeleton type="pie"  height={320} />
            </div>
          )}

          {/* ── Graphiques lazy-loaded ─────────────────────────────────────── */}
          {!loading && data && (
            <div className="space-y-6">

              {/* Bar Chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-indigo-600/20 rounded-lg">
                    <BarChart2 className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-sm">Dépenses par catégorie</h2>
                    <p className="text-gray-500 text-xs">
                      Cumulé mensuel — {periode === "3m" ? "3" : periode === "12m" ? "12" : "6"} derniers mois
                    </p>
                  </div>
                </div>
                {data.barData.length > 0
                  ? <BarChartDepenses data={data.barData} />
                  : <p className="text-gray-500 text-center py-10 text-sm">Aucune donnée sur cette période</p>
                }
              </div>

              {/* Line Chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-emerald-600/20 rounded-lg">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-sm">Progression des enveloppes</h2>
                    <p className="text-gray-500 text-xs">% utilisé par mois — seuils 80% et 100%</p>
                  </div>
                </div>
                {data.lineData.length > 0
                  ? <LineChartEnveloppes data={data.lineData} />
                  : <p className="text-gray-500 text-center py-10 text-sm">Aucune enveloppe active trouvée</p>
                }
              </div>

              {/* Pie Chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-amber-600/20 rounded-lg">
                    <PieChart className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-sm">Répartition du budget</h2>
                    <p className="text-gray-500 text-xs">Mois en cours</p>
                  </div>
                </div>
                {data.pieData.length > 0
                  ? <PieChartBudget data={data.pieData} />
                  : <p className="text-gray-500 text-center py-10 text-sm">Aucun budget défini ce mois</p>
                }
              </div>

            </div>
          )}
        </>
      )}

      {/* ══ ONGLET COMPARAISON ═════════════════════════════════════════════ */}
      {!estTendances && <ComparaisonAnnuelle />}

    </div>
  )
}
