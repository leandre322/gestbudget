"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react"
import type { BarDataItem } from "@/lib/hooks/useAnalytiques"

const COLORS = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899",
]
// Couleur neutre, distincte de la palette vive : signale visuellement que
// "Autres" est un agregat, pas une vraie categorie.
const COULEUR_AUTRES = "#4b5563"
const NOM_AUTRES = "Autres"

// Categories detaillees par defaut : les plus grosses depenses cumulees sur
// la periode chargee. Compromis lisibilite/information : 6 barres + "Autres"
// = 7 entrees de legende max, contre ~30 avant ce correctif (une pile
// illisible, legende impossible a lire).
const TOP_N_DEFAUT = 6

export function BarChartDepenses({ data }: { data: BarDataItem[] }) {
  const [filtreOuvert, setFiltreOuvert] = useState(false)

  // Toutes les categories presentes, triees par depense cumulee decroissante
  // sur toute la periode chargee (pas seulement le dernier mois).
  const categoriesTriees = useMemo(() => {
    const totaux = new Map<string, number>()
    data.forEach((d) => {
      totaux.set(d.categorie, (totaux.get(d.categorie) ?? 0) + d.depenses)
    })
    return Array.from(totaux.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat)
  }, [data])

  // Categories affichees individuellement (le reste est fondu dans "Autres").
  // Initialisee au Top N par defaut, ajustable par l'utilisateur via le
  // panneau de filtre ci-dessous.
  const [categoriesDetaillees, setCategoriesDetaillees] = useState<Set<string>>(
    () => new Set(categoriesTriees.slice(0, TOP_N_DEFAUT))
  )

  // Reinitialise la selection au Top N quand le jeu de categories change
  // (nouvelle periode, refresh) : un ajustement manuel de l'utilisateur ne
  // survit donc pas a un changement de periode. Choix delibere — plus simple
  // a raisonner qu'une fusion partielle entre ancienne et nouvelle selection.
  const clefCategories = categoriesTriees.join("|")
  const clefCategoriesRef = useRef(clefCategories)
  useEffect(() => {
    if (clefCategoriesRef.current !== clefCategories) {
      clefCategoriesRef.current = clefCategories
      setCategoriesDetaillees(new Set(categoriesTriees.slice(0, TOP_N_DEFAUT)))
    }
  }, [clefCategories, categoriesTriees])

  const toggleCategorie = (cat: string) => {
    setCategoriesDetaillees((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const { chartData, categoriesAffichees, aDesAutres } = useMemo(() => {
    const moisList = Array.from(new Set(data.map((d) => d.mois))).sort()
    const aDesAutres = categoriesTriees.some((c) => !categoriesDetaillees.has(c))

    const chartData = moisList.map((mois) => {
      const row: Record<string, string | number> = { mois }
      let autres = 0
      data
        .filter((d) => d.mois === mois)
        .forEach((d) => {
          if (categoriesDetaillees.has(d.categorie)) {
            row[d.categorie] = d.depenses
          } else {
            autres += d.depenses
          }
        })
      if (aDesAutres) row[NOM_AUTRES] = autres
      return row
    })

    const categoriesAffichees = categoriesTriees.filter((c) => categoriesDetaillees.has(c))
    return { chartData, categoriesAffichees, aDesAutres }
  }, [data, categoriesTriees, categoriesDetaillees])

  return (
    <div>
      {/* Filtre de categories — repliable pour ne pas alourdir la vue par defaut */}
      <div className="mb-4">
        <button
          onClick={() => setFiltreOuvert((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtrer les categories
          {filtreOuvert ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="text-gray-600">
            ({categoriesAffichees.length} affichee{categoriesAffichees.length > 1 ? "s" : ""}
            {aDesAutres ? `, ${categoriesTriees.length - categoriesAffichees.length} dans "${NOM_AUTRES}"` : ""})
          </span>
        </button>

        {filtreOuvert && (
          <div className="mt-2 p-3 bg-gray-950 border border-gray-800 rounded-lg max-h-48 overflow-y-auto space-y-1.5">
            {categoriesTriees.map((cat) => (
              <label key={cat} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={categoriesDetaillees.has(cat)}
                  onChange={() => toggleCategorie(cat)}
                  className="rounded border-gray-700 bg-gray-900 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-gray-950"
                />
                {cat}
              </label>
            ))}
            <button
              onClick={() => setCategoriesDetaillees(new Set(categoriesTriees.slice(0, TOP_N_DEFAUT)))}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-2"
            >
              Reinitialiser (top {TOP_N_DEFAUT})
            </button>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="mois" tick={{ fill: "#6b7280", fontSize: 11 }} />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 11 }}
            tickFormatter={(v) => `${v}€`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            labelStyle={{ color: "#f9fafb", fontWeight: 600 }}
            formatter={(v: number) => [`${v.toFixed(0)} €`]}
          />
          <Legend wrapperStyle={{ color: "#6b7280", fontSize: 11 }} />
          {categoriesAffichees.map((cat, i) => (
            <Bar
              key={cat}
              dataKey={cat}
              stackId="stack"
              fill={COLORS[i % COLORS.length]}
              radius={!aDesAutres && i === categoriesAffichees.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
          {aDesAutres && (
            <Bar dataKey={NOM_AUTRES} stackId="stack" fill={COULEUR_AUTRES} radius={[4, 4, 0, 0]} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
