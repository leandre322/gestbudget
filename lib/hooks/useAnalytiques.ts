import { useState, useEffect, useCallback } from "react"

export type Periode = "3m" | "6m" | "12m"

export interface BarDataItem {
  mois: string
  categorie: string
  depenses: number
  budget: number
}

export interface LineDataItem {
  mois: string
  enveloppe: string
  pourcentage: number
}

export interface PieDataItem {
  categorie: string
  montant: number
  depenses: number
  pourcentage: number
}

export interface AnalytiquesData {
  barData: BarDataItem[]
  lineData: LineDataItem[]
  pieData: PieDataItem[]
}

export function useAnalytiques(periode: Periode) {
  const [data, setData] = useState<AnalytiquesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/analytiques?periode=${periode}`)
      if (!res.ok) throw new Error("Erreur API analytiques")
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue")
    } finally {
      setLoading(false)
    }
  }, [periode])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}