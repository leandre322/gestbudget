"use client"
import { useMemo } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts"
import type { LineDataItem } from "@/lib/hooks/useAnalytiques"

const COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6"]

export function LineChartEnveloppes({ data }: { data: LineDataItem[] }) {
  const { chartData, enveloppes } = useMemo(() => {
    const enveloppes = Array.from(new Set(data.map((d) => d.enveloppe)))
    const moisList = Array.from(new Set(data.map((d) => d.mois))).sort()

    const chartData = moisList.map((mois) => {
      const row: Record<string, string | number> = { mois }
      enveloppes.forEach((env) => {
        const item = data.find((d) => d.mois === mois && d.enveloppe === env)
        row[env] = item?.pourcentage ?? 0
      })
      return row
    })

    return { chartData, enveloppes }
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="mois" tick={{ fill: "#6b7280", fontSize: 11 }} />
        <YAxis
          tick={{ fill: "#6b7280", fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
          domain={[0, 120]}
        />
        <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 4"
          label={{ value: "80%", fill: "#f59e0b", fontSize: 10, position: "right" }} />
        <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4"
          label={{ value: "100%", fill: "#ef4444", fontSize: 10, position: "right" }} />
        <Tooltip
          contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
          labelStyle={{ color: "#f9fafb", fontWeight: 600 }}
          formatter={(v: number) => [`${v}%`]}
        />
        <Legend wrapperStyle={{ color: "#6b7280", fontSize: 11 }} />
        {enveloppes.map((env, i) => (
          <Line
            key={env}
            type="monotone"
            dataKey={env}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}