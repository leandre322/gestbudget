"use client"
import { useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import type { BarDataItem } from "@/lib/hooks/useAnalytiques"

const COLORS = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899",
]

export function BarChartDepenses({ data }: { data: BarDataItem[] }) {
  const { chartData, categories } = useMemo(() => {
    const categories = Array.from(new Set(data.map((d) => d.categorie)))
    const moisList = Array.from(new Set(data.map((d) => d.mois))).sort()

    const chartData = moisList.map((mois) => {
      const row: Record<string, string | number> = { mois }
      categories.forEach((cat) => {
        const item = data.find((d) => d.mois === mois && d.categorie === cat)
        row[cat] = item?.depenses ?? 0
      })
      return row
    })

    return { chartData, categories }
  }, [data])

  return (
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
        {categories.map((cat, i) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="stack"
            fill={COLORS[i % COLORS.length]}
            radius={i === categories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}