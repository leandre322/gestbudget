"use client"
import { useState } from "react"
import { useAnalytiques, type Periode } from "@/lib/hooks/useAnalytiques"
import { BarChartDepenses } from "@/components/analytics/BarChartDepenses"
import { LineChartEnveloppes } from "@/components/analytics/LineChartEnveloppes"
import { PieChartBudget } from "@/components/analytics/PieChartBudget"
import { BarChart2, TrendingUp, PieChart, Download, Loader2, RefreshCw } from "lucide-react"

const PERIODES: { label: string; value: Periode }[] = [
  { label: "3 mois", value: "3m" },
  { label: "6 mois", value: "6m" },
  { label: "12 mois", value: "12m" },
]

export default function AnalytiquesPage() {
  const [periode, setPeriode] = useState<Periode>("6m")
  const [exportLoading, setExportLoading] = useState(false)
  const { data, loading, error, refetch } = useAnalytiques(periode)

  const handleExport = async () => {
  setExportLoading(true)
  try {
    const annee = new Date().getFullYear()
    const mois = new Date().getMonth() + 1
    // Utilise la route existante jsPDF — même format que le bouton déjà en prod
    const res = await fetch(`/api/export/pdf?annee=${annee}&mois=${mois}`)
    if (!res.ok) throw new Error('Erreur export')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GestBudget-${annee}-${String(mois).padStart(2, '0')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('[export/pdf]', e)
  } finally {
    setExportLoading(false)
  }
}

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytiques</h1>
          <p className="text-gray-400 text-sm mt-1">
            Visualisez vos tendances budgétaires
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Sélecteur période */}
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

          {/* Rafraîchir */}
          <button
            onClick={refetch}
            className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white transition-all"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Export PDF */}
          <button
            onClick={handleExport}
            disabled={exportLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Exporter PDF
          </button>
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* Chargement */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
      )}

      {/* Graphiques */}
      {!loading && data && (
        <div className="space-y-6">
          {/* Bar Chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-indigo-600/20 rounded-lg">
                <BarChart2 className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-sm">
                  Dépenses par catégorie
                </h2>
                <p className="text-gray-500 text-xs">Cumulé mensuel — {periode === "3m" ? "3" : periode === "12m" ? "12" : "6"} derniers mois</p>
              </div>
            </div>
            {data.barData.length > 0 ? (
              <BarChartDepenses data={data.barData} />
            ) : (
              <p className="text-gray-500 text-center py-10 text-sm">
                Aucune donnée sur cette période
              </p>
            )}
          </div>

          {/* Line Chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-emerald-600/20 rounded-lg">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-sm">
                  Progression des enveloppes
                </h2>
                <p className="text-gray-500 text-xs">% utilisé par mois — seuils 80% et 100%</p>
              </div>
            </div>
            {data.lineData.length > 0 ? (
              <LineChartEnveloppes data={data.lineData} />
            ) : (
              <p className="text-gray-500 text-center py-10 text-sm">
                Aucune enveloppe active trouvée
              </p>
            )}
          </div>

          {/* Pie Chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-2 bg-amber-600/20 rounded-lg">
                <PieChart className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-white font-semibold text-sm">
                  Répartition du budget
                </h2>
                <p className="text-gray-500 text-xs">Mois en cours</p>
              </div>
            </div>
            {data.pieData.length > 0 ? (
              <PieChartBudget data={data.pieData} />
            ) : (
              <p className="text-gray-500 text-center py-10 text-sm">
                Aucun budget défini ce mois
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}