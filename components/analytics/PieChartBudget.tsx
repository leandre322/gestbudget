"use client"
import {
  PieChart, Pie, Cell, Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { PieDataItem } from "@/lib/hooks/useAnalytiques"

const COLORS = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899",
]

export function PieChartBudget({ data }: { data: PieDataItem[] }) {
  const pieData = data.map((d) => ({
    name: d.categorie,
    value: d.montant,
    depenses: d.depenses,
    pourcentage: d.pourcentage,
  }))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={95}
            paddingAngle={3}
            dataKey="value"
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            formatter={(value: number, name: string, props: any) => [
              `Budget: ${value}€ — Dépensé: ${props.payload.depenses}€`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Légende détaillée */}
      <div className="space-y-2.5">
        {pieData.map((item, i) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-gray-300 text-sm truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
            <div className="text-right ml-4 flex-shrink-0">
              <span className="text-white text-sm font-medium">{item.value.toFixed(0)} €</span>
              <span className="text-gray-500 text-xs ml-1.5">({item.pourcentage}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}