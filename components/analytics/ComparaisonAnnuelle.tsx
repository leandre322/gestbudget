"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import {
  AlertTriangle, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, Target,
} from "lucide-react"

// =============================================================================
//  S7 / F9 — Comparaison annuelle N vs N-1
//  Consomme GET /api/analytiques/comparaison
//
//  Ce composant est importe dynamiquement avec ssr:false depuis la page :
//  Recharts manipule le DOM/SVG et n'existe pas cote serveur.
// =============================================================================

type FamilleCle = "revenus" | "depenses" | "epargne" | "dette"

type Famille = {
  cle: FamilleCle
  label: string
  sens: "positif" | "negatif" | "neutre"
  reelN: number
  reelN1: number
  anticipeN: number
  anticipeN1: number
  deltaAbs: number
  deltaPct: number | null
  tauxRealisationN: number | null
  tauxRealisationN1: number | null
  nbCategories: number
}

type LigneCategorie = {
  id: string
  nom: string
  type: string
  famille: FamilleCle
  reelN: number
  reelN1: number
  anticipeN: number
  anticipeN1: number
  deltaAbs: number
  deltaPct: number | null
  tauxRealisationN: number | null
  tauxRealisationN1: number | null
  statut: "commun" | "nouveau" | "disparu"
}

type Reponse = {
  annee: number
  anneeRef: number
  mode: "complet" | "ytd"
  moisMax: number
  moisCourant: number
  estAnneeEnCours: boolean
  anneesDisponibles: number[]
  disponible: { annee: boolean; anneeRef: boolean }
  familles: Famille[]
  mensuel: { mois: string; moisNum: number; reelN: number | null; reelN1: number }[]
  categories: LigneCategorie[]
}

const MOIS_LONGS = ["", "janvier", "février", "mars", "avril", "mai", "juin",
                    "juillet", "août", "septembre", "octobre", "novembre", "décembre"]

// Format monetaire complet (F CFA, separateur d'espace fine insecable)
const fmt = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v)) + " F"

// Format compact pour les axes du graphe
const fmtCompact = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1000000) return (v / 1000000).toFixed(1).replace(".0", "") + "M"
  if (a >= 1000)    return Math.round(v / 1000) + "k"
  return String(Math.round(v))
}

const fmtPct = (p: number | null) => {
  if (p === null) return "—"
  const s = p > 0 ? "+" : ""
  return s + (Math.abs(p) < 10 ? p.toFixed(1) : Math.round(p).toString()) + " %"
}

// Couleur d'un ecart selon le sens de la famille.
// Une hausse de revenus est verte, une hausse de depenses est rouge,
// une variation de remboursement de dette reste neutre.
const couleurDelta = (delta: number, sens: Famille["sens"]) => {
  if (delta === 0 || sens === "neutre") return "text-gray-400"
  const favorable = sens === "positif" ? delta > 0 : delta < 0
  return favorable ? "text-emerald-400" : "text-red-400"
}

const FILTRES: { cle: FamilleCle | "toutes"; label: string }[] = [
  { cle: "toutes",   label: "Toutes"    },
  { cle: "revenus",  label: "Revenus"   },
  { cle: "depenses", label: "Dépenses"  },
  { cle: "epargne",  label: "Épargne"   },
  { cle: "dette",    label: "Dette"     },
]

export default function ComparaisonAnnuelle() {
  const anneeParDefaut = new Date().getFullYear()

  const [annee,      setAnnee]      = useState<number>(anneeParDefaut)
  const [mode,       setMode]       = useState<"complet" | "ytd">("complet")
  const [filtre,     setFiltre]     = useState<FamilleCle | "toutes">("toutes")
  const [showPrevu,  setShowPrevu]  = useState(false)
  const [data,       setData]       = useState<Reponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const charger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/analytiques/comparaison?annee=${annee}&mode=${mode}`)
      if (!res.ok) throw new Error("Chargement impossible")
      setData(await res.json())
    } catch (e) {
      setError("Impossible de charger la comparaison")
      setData(null)
    }
    setLoading(false)
  }, [annee, mode])

  useEffect(() => { charger() }, [charger])

  // Invalide le cache serveur (tag partage avec /api/analytiques) puis recharge
  const rafraichir = async () => {
    setRefreshing(true)
    try {
      await fetch("/api/analytiques/invalidate", { method: "POST" })
    } catch {
      // best-effort
    } finally {
      await charger()
      setRefreshing(false)
    }
  }

  const categoriesFiltrees = useMemo(() => {
    if (!data) return []
    return filtre === "toutes"
      ? data.categories
      : data.categories.filter(c => c.famille === filtre)
  }, [data, filtre])

  const sensParFamille = useMemo(() => {
    const m = new Map<FamilleCle, Famille["sens"]>()
    data?.familles.forEach(f => m.set(f.cle, f.sens))
    return m
  }, [data])

  // Avertissement : annee en cours comparee en integralite a une annee revolue
  const compareTronquee = !!data && data.estAnneeEnCours && data.mode === "complet"

  return (
    <div className="space-y-6">

      {/* ── Contrôles ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold">Comparaison annuelle</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {data ? `${data.annee} face à ${data.anneeRef}` : "Chargement…"}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Année */}
          <select
            value={annee}
            onChange={e => setAnnee(parseInt(e.target.value, 10))}
            className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-600"
          >
            {(data?.anneesDisponibles?.length ? data.anneesDisponibles : [anneeParDefaut]).map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          {/* Mode */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-1">
            <button
              onClick={() => setMode("complet")}
              className={`px-3 py-1.5 text-sm rounded-md transition-all font-medium ${
                mode === "complet" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Année complète
            </button>
            <button
              onClick={() => setMode("ytd")}
              className={`px-3 py-1.5 text-sm rounded-md transition-all font-medium ${
                mode === "ytd" ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              À date
            </button>
          </div>

          <button
            onClick={rafraichir}
            disabled={refreshing}
            className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white transition-all disabled:opacity-50"
            title="Rafraîchir (invalide le cache)"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Avertissement années partielles ───────────────────────────────── */}
      {compareTronquee && data && (
        <div className="bg-amber-900/20 border border-amber-800 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-amber-300 font-medium">Comparaison d'années de longueurs différentes</p>
            <p className="text-amber-200/70 text-xs mt-1 leading-relaxed">
              {data.annee} s'arrête à {MOIS_LONGS[data.moisCourant]} et compte {data.moisCourant} mois,
              face à 12 mois pour {data.anneeRef}. Les écarts affichés incluent
              donc {12 - data.moisCourant} mois manquants. Passe en
              <strong className="text-amber-200"> À date</strong> pour comparer
              janvier–{MOIS_LONGS[data.moisCourant]} des deux années.
            </p>
          </div>
        </div>
      )}

      {/* ── Année de référence absente ────────────────────────────────────── */}
      {data && !data.disponible.anneeRef && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-400">
          Aucune donnée pour {data.anneeRef} — la comparaison affiche {data.annee} seule.
        </div>
      )}

      {/* ── Erreur ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* ── Chargement ────────────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-32 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="h-80 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Cartes par famille ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {data.familles.map(f => {
              const hausse = f.deltaAbs > 0
              const nul    = f.deltaAbs === 0
              const Icone  = nul ? Minus : hausse ? ArrowUpRight : ArrowDownRight
              return (
                <div key={f.cle} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide">{f.label}</p>

                  <p className="text-lg font-bold text-white mt-2 leading-tight">{fmt(f.reelN)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{fmt(f.reelN1)} en {data.anneeRef}</p>

                  <div className={`flex items-center gap-1 mt-2 text-sm font-semibold ${couleurDelta(f.deltaAbs, f.sens)}`}>
                    <Icone className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{fmtPct(f.deltaPct)}</span>
                    <span className="text-gray-600 font-normal text-xs truncate">
                      ({hausse ? "+" : ""}{fmt(f.deltaAbs)})
                    </span>
                  </div>

                  {/* Fiabilité des prévisions : réel / anticipé */}
                  {f.tauxRealisationN !== null && (
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-800">
                      <Target className="w-3 h-3 text-gray-600 flex-shrink-0" />
                      <span className="text-[11px] text-gray-500">
                        Prévu réalisé à{" "}
                        <span className="text-gray-300 font-medium">
                          {Math.round(f.tauxRealisationN)} %
                        </span>
                        {f.tauxRealisationN1 !== null && (
                          <span className="text-gray-600"> · {Math.round(f.tauxRealisationN1)} % en {data.anneeRef}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Graphe mensuel ──────────────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="mb-6">
              <h3 className="text-white font-semibold text-sm">Dépenses mensuelles</h3>
              <p className="text-gray-500 text-xs mt-0.5">
                Dépenses réelles mois par mois — {data.annee} face à {data.anneeRef}
              </p>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.mensuel} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                <XAxis dataKey="mois" stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#e5e7eb" }}
                  formatter={(v: any) => (v === null ? "—" : fmt(Number(v)))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="reelN1" name={String(data.anneeRef)} fill="#4b5563" radius={[3, 3, 0, 0]} />
                <Bar dataKey="reelN"  name={String(data.annee)}    fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Tableau par catégorie ───────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h3 className="text-white font-semibold text-sm">Écarts par catégorie</h3>
                <p className="text-gray-500 text-xs mt-0.5">Triés par écart absolu décroissant</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex bg-gray-950 border border-gray-800 rounded-lg p-1">
                  {FILTRES.map(f => (
                    <button
                      key={f.cle}
                      onClick={() => setFiltre(f.cle)}
                      className={`px-2.5 py-1 text-xs rounded-md transition-all font-medium ${
                        filtre === f.cle ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowPrevu(v => !v)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-800 text-gray-400 hover:text-white transition-all"
                >
                  {showPrevu ? "Masquer le prévu" : "Afficher le prévu"}
                </button>
              </div>
            </div>

            {categoriesFiltrees.length === 0 ? (
              <p className="text-gray-500 text-center py-10 text-sm">Aucune donnée sur ce périmètre</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase tracking-wide border-b border-gray-800">
                      <th className="text-left  font-medium py-2 pr-4">Catégorie</th>
                      <th className="text-right font-medium py-2 px-3 whitespace-nowrap">{data.anneeRef}</th>
                      <th className="text-right font-medium py-2 px-3 whitespace-nowrap">{data.annee}</th>
                      <th className="text-right font-medium py-2 px-3">Écart</th>
                      <th className="text-right font-medium py-2 pl-3">%</th>
                      {showPrevu && (
                        <>
                          <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">Prévu {data.annee}</th>
                          <th className="text-right font-medium py-2 pl-3">Réalisé</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {categoriesFiltrees.map(c => {
                      const sens = sensParFamille.get(c.famille) ?? "neutre"
                      return (
                        <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-200">{c.nom}</span>
                              {c.statut === "nouveau" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300">nouveau</span>
                              )}
                              {c.statut === "disparu" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/40 text-gray-400">arrêtée</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-500 whitespace-nowrap">{fmt(c.reelN1)}</td>
                          <td className="py-2.5 px-3 text-right text-gray-200 whitespace-nowrap">{fmt(c.reelN)}</td>
                          <td className={`py-2.5 px-3 text-right whitespace-nowrap font-medium ${couleurDelta(c.deltaAbs, sens)}`}>
                            {c.deltaAbs > 0 ? "+" : ""}{fmt(c.deltaAbs)}
                          </td>
                          <td className={`py-2.5 pl-3 text-right whitespace-nowrap ${couleurDelta(c.deltaAbs, sens)}`}>
                            {fmtPct(c.deltaPct)}
                          </td>
                          {showPrevu && (
                            <>
                              <td className="py-2.5 pl-3 text-right text-gray-500 whitespace-nowrap">
                                {c.anticipeN > 0 ? fmt(c.anticipeN) : "—"}
                              </td>
                              <td className="py-2.5 pl-3 text-right text-gray-400 whitespace-nowrap">
                                {c.tauxRealisationN !== null ? Math.round(c.tauxRealisationN) + " %" : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
