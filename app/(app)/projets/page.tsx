'use client'

import { useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { toast } from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Projet {
  id: string
  nom: string
  description?: string | null
  montantCible: number
  montantActuel: number
  pourcentage: number
  dateDebut: string
  dateCible: string
  statut: 'actif' | 'atteint' | 'abandonne'
  notifSeuils: string
  enRetard: boolean
  joursRestants: number | null
  categorieId?: string | null
  compteFondsId?: string | null
  categorie?: { id: string; nom: string; couleur?: string } | null
  compteFonds?: { id: string; nom: string } | null
}

interface Categorie { id: string; nom: string; couleur?: string; type: string }
interface Compte    { id: string; nom: string; solde: number }

// ── Helpers ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatMontant(m: number) {
  return new Intl.NumberFormat('fr-FR').format(m) + ' FCFA'
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function montantContribMensuelle(montantCible: number, montantActuel: number, dateCible: string): number {
  const restant = montantCible - montantActuel
  if (restant <= 0) return 0
  const jours = Math.max(1, Math.round((new Date(dateCible).getTime() - Date.now()) / 86400000))
  const mois  = Math.max(1, jours / 30)
  return Math.ceil(restant / mois)
}

// ── Jauge circulaire ──────────────────────────────────────────────────────────
function JaugeCirculaire({ pourcentage, atteint, taille = 80 }: {
  pourcentage: number
  atteint: boolean
  taille?: number
}) {
  const r = (taille / 2) - 8
  const circonference = 2 * Math.PI * r
  const offset = circonference - (Math.min(pourcentage, 100) / 100) * circonference
  const couleur = atteint
    ? '#f59e0b'   // or pour atteint
    : pourcentage >= 75
    ? '#10b981'   // vert
    : pourcentage >= 40
    ? '#3b82f6'   // bleu
    : '#6366f1'   // violet

  return (
    <div className="relative flex-shrink-0" style={{ width: taille, height: taille }}>
      <svg width={taille} height={taille} className="-rotate-90">
        {/* Piste fond */}
        <circle
          cx={taille / 2} cy={taille / 2} r={r}
          fill="none" stroke="currentColor"
          strokeWidth="6"
          className="text-gray-200 dark:text-gray-700"
        />
        {/* Arc progression */}
        <circle
          cx={taille / 2} cy={taille / 2} r={r}
          fill="none"
          stroke={couleur}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circonference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease-in-out' }}
        />
      </svg>
      {/* Texte centré */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {atteint ? (
          <span style={{ fontSize: taille * 0.28 }}>🎯</span>
        ) : (
          <span className="font-bold text-gray-800 dark:text-white leading-none" style={{ fontSize: taille * 0.22 }}>
            {pourcentage}%
          </span>
        )}
      </div>
    </div>
  )
}

// ── Modale versement ──────────────────────────────────────────────────────────
function ModaleVersement({
  projet,
  categories,
  comptes,
  onClose,
  onSuccess,
}: {
  projet: Projet
  categories: Categorie[]
  comptes: Compte[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [montant, setMontant]       = useState('')
  const [categorieId, setCategorieId] = useState('')
  const [compteId, setCompteId]     = useState('')
  const [loading, setLoading]       = useState(false)

  const restant = projet.montantCible - projet.montantActuel

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const m = Number(montant)
    if (!m || m <= 0) { toast.error('Montant invalide'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/projets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _action: 'versement',
          projetId: projet.id,
          montant: m,
          categorieId: categorieId || null,
          compteId: compteId || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message || 'Erreur versement')
        return
      }
      toast.success('Versement enregistré')
      onSuccess()
      onClose()
    } catch {
      toast.error('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Verser sur « {projet.nom} »
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-400">
          Restant a  atteindre : <strong>{formatMontant(restant)}</strong>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Montant a  verser (FCFA) <span className="text-red-500">*</span>
            </label>
            <input
              type="number" value={montant}
              onChange={e => setMontant(e.target.value)}
              placeholder="0" required min="1"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Catégorie du décaissement</label>
            <select value={categorieId} onChange={e => setCategorieId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="">Sans catégorie</option>
              {categories.filter((b: Categorie) => b.type === 'depense').map((c: Categorie) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Compte source</label>
            <select value={compteId} onChange={e => setCompteId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
              <option value="">Sans compte</option>
              {comptes.map((c: Compte) => (
                <option key={c.id} value={c.id}>{c.nom} ({formatMontant(c.solde)})</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Verser
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modale simulateur ─────────────────────────────────────────────────────────
function ModaleSimulateur({ projet, onClose }: { projet: Projet; onClose: () => void }) {
  const [mode, setMode] = useState<'duree' | 'epargne'>('duree')
  const [valeur, setValeur] = useState('')

  const restant = projet.montantCible - projet.montantActuel

  const resultat = useMemo(() => {
    const v = Number(valeur)
    if (!v || v <= 0 || restant <= 0) return null
    if (mode === 'duree') {
      // Si j'epargne V FCFA/mois -> combien de mois ?
      const mois = Math.ceil(restant / v)
      const date = new Date()
      date.setMonth(date.getMonth() + mois)
      return { mois, date: date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }
    } else {
      // Pour atteindre a la date cible -> combien / mois ?
      const jours = Math.max(1, Math.round((new Date(projet.dateCible).getTime() - Date.now()) / 86400000))
      const mois  = Math.max(1, Math.ceil(jours / 30))
      const montantMensuel = Math.ceil(restant / mois)
      return { montantMensuel, mois }
    }
  }, [mode, valeur, restant, projet.dateCible])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Simulateur — {projet.nom}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-400">
          Restant : <strong className="text-gray-900 dark:text-white">{formatMontant(restant)}</strong>
          {' · '}Date cible : <strong className="text-gray-900 dark:text-white">{formatDate(projet.dateCible)}</strong>
        </div>

        {/* Toggle mode */}
        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 mb-4">
          <button onClick={() => { setMode('duree'); setValeur('') }}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'duree' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
            Combien de mois ?
          </button>
          <button onClick={() => { setMode('epargne'); setValeur('') }}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'epargne' ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
            Combien / mois ?
          </button>
        </div>

        {/* Input */}
        {mode === 'duree' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Epargne mensuelle (FCFA)
            </label>
            <input type="number" value={valeur} onChange={e => setValeur(e.target.value)}
              placeholder="Ex : 50000" min="1"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
        )}

        {/* Résultat */}
        {resultat && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
            {mode === 'duree' && 'mois' in resultat && (
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{resultat.mois} mois</p>
                <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">Objectif atteint en {resultat.date}</p>
              </div>
            )}
            {mode === 'epargne' && 'montantMensuel' in resultat && (
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{formatMontant(resultat.montantMensuel??0)}</p>
                <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">par mois pendant {resultat.mois} mois</p>
              </div>
            )}
          </div>
        )}

        <button onClick={onClose}
          className="w-full mt-4 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
          Fermer
        </button>
      </div>
    </div>
  )
}

// ── Modale création projet ---------
function ModaleCreerProjet({
  categories,
  comptes,
  onClose,
  onSuccess,
}: {
  categories: Categorie[]
  comptes: Compte[]
  onClose: () => void
  onSuccess: () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [nom, setNom]                 = useState('')
  const [description, setDescription] = useState('')
  const [montantCible, setMontantCible] = useState('')
  const [dateDebut, setDateDebut]     = useState(today)
  const [dateCible, setDateCible]     = useState('')
  const [categorieId, setCategorieId] = useState('')
  const [compteFondsId, setCompteFondsId] = useState('')
  const [loading, setLoading]         = useState(false)

  const contribMensuelle = useMemo(() => {
    const m = Number(montantCible)
    if (!m || !dateCible) return 0
    const jours = Math.max(1, Math.round((new Date(dateCible).getTime() - Date.now()) / 86400000))
    return Math.ceil(m / Math.max(1, jours / 30))
  }, [montantCible, dateCible])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!montantCible || Number(montantCible) <= 0) { toast.error('Montant cible invalide'); return }
    if (!dateCible) { toast.error('Date cible requise'); return }
    if (new Date(dateCible) <= new Date(dateDebut)) { toast.error('Date cible doit etre après date de début'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/projets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom, description: description || null,
          montantCible: Number(montantCible),
          dateDebut, dateCible,
          categorieId: categorieId || null,
          compteFondsId: compteFondsId || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message || 'Erreur création')
        return
      }
      toast.success('Projet créé')
      onSuccess()
      onClose()
    } catch {
      toast.error('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nouveau projet</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nom du projet <span className="text-red-500">*</span></label>
            <input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="Ex : Achat voiture" required maxLength={100}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Facultatif" maxLength={500}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Montant cible (FCFA) <span className="text-red-500">*</span></label>
            <input type="number" value={montantCible} onChange={e => setMontantCible(e.target.value)} placeholder="0" required min="1"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date de début</label>
              <input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date cible <span className="text-red-500">*</span></label>
              <input type="date" value={dateCible} onChange={e => setDateCible(e.target.value)} required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
          {/* Suggestion contribution mensuelle */}
          {contribMensuelle > 0 && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg text-sm text-emerald-700 dark:text-emerald-400">
              💡 Contribution mensuelle suggérée : <strong>{formatMontant(contribMensuelle)}</strong>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Catégorie</label>
              <select value={categorieId} onChange={e => setCategorieId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">Aucune</option>
                {categories.map((c: Categorie) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Compte fonds</label>
              <select value={compteFondsId} onChange={e => setCompteFondsId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">Aucun</option>
                {comptes.map((c: Compte) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Créer le projet
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Carte projet ──────────────────────────────────────────────────────────────
function CarteProjet({
  projet,
  categories,
  comptes,
  onMutate,
}: {
  projet: Projet
  categories: Categorie[]
  comptes: Compte[]
  onMutate: () => void
}) {
  const [showVersement, setShowVersement]   = useState(false)
  const [showSimulateur, setShowSimulateur] = useState(false)

  const contrib = montantContribMensuelle(projet.montantCible, projet.montantActuel, projet.dateCible)
  const atteint = projet.statut === 'atteint' || projet.pourcentage >= 100
  const depasse  = projet.montantActuel > projet.montantCible

  const handleStatut = async (statut: 'actif' | 'abandonne') => {
    const res = await fetch('/api/projets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projet.id, statut }),
    })
    if (res.ok) { toast.success('Statut mis a  jour'); onMutate() }
    else toast.error('Erreur')
  }

  return (
    <>
      <div className={`bg-white dark:bg-gray-800 rounded-xl border shadow-sm p-4 flex flex-col gap-3 ${
        projet.enRetard
          ? 'border-red-300 dark:border-red-700'
          : atteint
          ? 'border-amber-300 dark:border-amber-700'
          : 'border-gray-200 dark:border-gray-700'
      }`}>
        {/* En-tete */}
        <div className="flex items-start gap-3">
          <JaugeCirculaire pourcentage={projet.pourcentage} atteint={atteint} taille={72} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">{projet.nom}</h3>
              {projet.enRetard && (
                <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full">
                  En retard
                </span>
              )}
              {atteint && !depasse && (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
                  Atteint
                </span>
              )}
            </div>
            {projet.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{projet.description}</p>
            )}
            {/* Montants */}
            <div className="mt-1 text-sm">
              <span className="font-semibold text-gray-800 dark:text-gray-200">{formatMontant(projet.montantActuel)}</span>
              <span className="text-gray-400 dark:text-gray-500"> / {formatMontant(projet.montantCible)}</span>
            </div>
            {/* Dépassement */}
            {depasse && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                +{formatMontant(projet.montantActuel - projet.montantCible)} au-delà de l'objectif
              </p>
            )}
          </div>
        </div>

        {/* Dates */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Début : {formatDate(projet.dateDebut)}</span>
          <span className={projet.enRetard ? 'text-red-500 dark:text-red-400 font-medium' : ''}>
            Cible : {formatDate(projet.dateCible)}
            {projet.joursRestants !== null && projet.joursRestants > 0 && (
              <span className="ml-1 text-gray-400">({projet.joursRestants}j)</span>
            )}
          </span>
        </div>

        {/* Contribution suggérée (actif seulement) */}
        {projet.statut === 'actif' && !atteint && contrib > 0 && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-lg">
            💡 {formatMontant(contrib)}/mois pour atteindre l'objectif
          </div>
        )}

        {/* Actions (actif seulement) */}
        {projet.statut === 'actif' && (
          <div className="flex gap-2">
            <button onClick={() => setShowVersement(true)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors">
              + Verser
            </button>
            <button onClick={() => setShowSimulateur(true)}
              className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
              Simuler
            </button>
            <button onClick={() => handleStatut('abandonne')}
              className="bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg px-3 py-1.5 text-xs transition-colors"
              title="Abandonner">
              ✕
            </button>
          </div>
        )}

        {/* Statut archive */}
        {projet.statut === 'abandonne' && (
          <div className="flex gap-2">
            <button onClick={() => handleStatut('actif')}
              className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
              Réactiver
            </button>
          </div>
        )}
      </div>

      {showVersement && (
        <ModaleVersement
          projet={projet} categories={categories} comptes={comptes}
          onClose={() => setShowVersement(false)} onSuccess={onMutate}
        />
      )}
      {showSimulateur && (
        <ModaleSimulateur projet={projet} onClose={() => setShowSimulateur(false)} />
      )}
    </>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function ProjetsPage() {
  useSession({ required: true })

  const [onglet, setOnglet] = useState<'actifs' | 'archives'>('actifs')
  const [showCreer, setShowCreer] = useState(false)

  const { data: projetsRes, mutate } = useSWR<{ projets: Projet[]; nbRetard: number }>(
    '/api/projets', fetcher, { refreshInterval: 60000 }
  )
  const { data: categoriesRes } = useSWR<{ categories: Categorie[] }>('/api/categories', fetcher)
  const { data: comptesRes }    = useSWR<{ comptes: Compte[] }>('/api/comptes', fetcher)

  const tousLesProjets = projetsRes?.projets ?? []
  const categories     = categoriesRes?.categories ?? []
  const comptes        = comptesRes?.comptes ?? []

  const projetsActifs  = tousLesProjets.filter((p: Projet) => p.statut === 'actif' || p.statut === 'atteint')
  const projetsArchives = tousLesProjets.filter((p: Projet) => p.statut === 'abandonne')
  const nbRetard       = projetsRes?.nbRetard ?? 0

  const affiches = onglet === 'actifs' ? projetsActifs : projetsArchives

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Projets
            {nbRetard > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 bg-red-500 text-white text-xs rounded-full font-bold">
                {nbRetard}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Planifiez et suivez vos objectifs d'épargne
          </p>
        </div>
        <button
          onClick={() => setShowCreer(true)}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm hover:shadow-md"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Nouveau projet
        </button>
      </div>

      {/* Onglets */}
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 w-fit">
        <button onClick={() => setOnglet('actifs')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            onglet === 'actifs'
              ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}>
          Actifs ({projetsActifs.length})
        </button>
        <button onClick={() => setOnglet('archives')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            onglet === 'archives'
              ? 'bg-white dark:bg-gray-600 shadow-sm text-gray-900 dark:text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}>
          Archivés ({projetsArchives.length})
        </button>
      </div>

      {/* Liste */}
      {affiches.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-gray-400">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {onglet === 'actifs'
              ? 'Aucun projet actif. Créez votre premier projet !'
              : 'Aucun projet archivé.'}
          </p>
          {onglet === 'actifs' && (
            <button onClick={() => setShowCreer(true)}
              className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">
              Créer un projet →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {affiches.map((p: Projet) => (
            <CarteProjet
              key={p.id} projet={p}
              categories={categories} comptes={comptes}
              onMutate={() => mutate()}
            />
          ))}
        </div>
      )}

      {/* Modales */}
      {showCreer && (
        <ModaleCreerProjet
          categories={categories} comptes={comptes}
          onClose={() => setShowCreer(false)}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  )
}
