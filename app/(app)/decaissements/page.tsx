'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { toast } from 'react-hot-toast'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Categorie {
  id: string
  nom: string
  couleur?: string
  type: string
}

interface Compte {
  id: string
  nom: string
  solde: number
}

interface Decaissement {
  id: string
  date: string
  description: string
  montant: number
  categorieId?: string
  compteId?: string
  sourceVocale: boolean
  categorie?: { nom: string; couleur?: string }
  compte?: { nom: string }
  createdAt: string
}

interface Parametres {
  langueVocale?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatMontant(m: number): string {
  return new Intl.NumberFormat('fr-FR').format(m) + ' FCFA'
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ── Wave animation (CSS inline) ───────────────────────────────────────────────
function WaveAnimation() {
  const delays = [0, 0.12, 0.24, 0.36, 0.48]
  return (
    <>
      <style>{`
        @keyframes lawwave {
          0%, 100% { transform: scaleY(0.35); opacity: 0.7; }
          50%       { transform: scaleY(1);    opacity: 1;   }
        }
        .law-wave-bar {
          animation: lawwave 0.75s ease-in-out infinite;
          transform-origin: center;
        }
      `}</style>
      <div className="flex items-center justify-center gap-px" style={{ height: '20px', width: '28px' }}>
        {delays.map((delay, i) => (
          <div
            key={i}
            className="law-wave-bar rounded-full bg-white"
            style={{ width: '3px', height: '100%', animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </>
  )
}

// ── Icone micro ───────────────────────────────────────────────────────────────
function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
      <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291A6.751 6.751 0 0 1 5.25 12.75v-1.5A.75.75 0 0 1 6 10.5Z" />
    </svg>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function DecaissementsPage() {
  useSession({ required: true })

  // ── Form state
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [montant, setMontant] = useState('')
  const [categorieId, setCategorieId] = useState('')
  const [compteId, setCompteId] = useState('')
  const [sourceVocale, setSourceVocale] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── Vocal state
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [pendingTranscript, setPendingTranscript] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const recognitionRef = useRef<any>(null)

  // ── SWR
  const { data: categoriesRes } = useSWR<{ categories: Categorie[] }>('/api/categories', fetcher)
  const { data: comptesRes }    = useSWR<{ comptes: Compte[] }>('/api/comptes', fetcher)
  const { data: parametresRes } = useSWR<Parametres>('/api/parametres', fetcher)
  const { data: decaisRes, mutate } = useSWR<{ decaissements: Decaissement[] }>(
    '/api/decaissements',
    fetcher
  )

  const categories   = (categoriesRes?.categories ?? []).filter((b: Categorie) => b.type === 'depense')
  const comptes      = comptesRes?.comptes ?? []
  const langueVocale = parametresRes?.langueVocale ?? 'fr-FR'
  const decaissements: Decaissement[] = decaisRes?.decaissements ?? []

  // ── Detection Web Speech API (client uniquement)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const supported =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
    setSpeechSupported(supported)
  }, [])

  // ── Nettoyage recognition a la fermeture
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  // ── Demarrage enregistrement (hold-to-talk)
  const startRecording = useCallback(() => {
    if (isRecording) return
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRec) return

    const recognition = new SpeechRec()
    recognition.lang = langueVocale
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    let finalAccumulated = ''

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalAccumulated += (finalAccumulated ? ' ' : '') + t.trim()
        } else {
          interim = t
        }
      }
      setInterimText(interim)
    }

    recognition.onerror = (event: any) => {
      setIsRecording(false)
      setInterimText('')
      if (event.error === 'not-allowed') {
        toast.error('Microphone non autorise. Verifiez les permissions.')
      } else if (event.error !== 'aborted') {
        toast.error('Erreur microphone : ' + event.error)
      }
    }

    recognition.onend = () => {
      setIsRecording(false)
      setInterimText('')
      if (finalAccumulated.trim()) {
        setPendingTranscript(finalAccumulated.trim())
        setShowConfirm(true)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsRecording(true)
      setPendingTranscript('')
      setShowConfirm(false)
    } catch {
      toast.error('Impossible de demarrer le microphone')
    }
  }, [isRecording, langueVocale])

  // ── Arret enregistrement
  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  // ── Confirmation de la transcription (remplace description)
  const confirmTranscript = () => {
    setDescription(pendingTranscript)
    setSourceVocale(true)
    setShowConfirm(false)
    setPendingTranscript('')
  }

  const cancelTranscript = () => {
    setShowConfirm(false)
    setPendingTranscript('')
  }

  // ── Saisie manuelle reinitialisee sourceVocale
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(e.target.value)
    if (sourceVocale) setSourceVocale(false)
  }

  // ── Texte affiche dans l'input pendant l'enregistrement
  const displayedDescription = isRecording
    ? [description, interimText].filter(Boolean).join(' ').trim()
    : description

  // ── Soumission du formulaire
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLocked || isSubmitting) return
    if (!montant || Number(montant) <= 0) {
      toast.error('Le montant doit etre superieur a 0')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/decaissements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim() || null,
          montant: Number(montant),
          categorieId: categorieId || undefined,
          compteId: compteId || undefined,
          sourceVocale,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message || 'Erreur lors de l\'ajout')
        return
      }

      toast.success('Decaissement enregistre')
      setDescription('')
      setMontant('')
      setCategorieId('')
      setCompteId('')
      setSourceVocale(false)
      await mutate()
    } catch {
      toast.error('Erreur reseau')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Décaissements</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Enregistrez vos sorties d'argent
          </p>
        </div>
        <button
          onClick={() => setIsLocked(!isLocked)}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            isLocked
              ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50'
          }`}
        >
          {isLocked ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 0 0-6 0V9h6Z" />
            </svg>
          )}
          {isLocked ? 'Verrouillé' : 'Déverrouillé'}
        </button>
      </div>

      {/* ── Banniere verrou ── */}
      {isLocked && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <div className="flex-shrink-0 w-8 h-8 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-600 dark:text-red-400">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Saisie verrouillée</p>
            <p className="text-xs text-red-600 dark:text-red-500">Cliquez sur le bouton en haut à droite pour déverrouiller</p>
          </div>
        </div>
      )}

      {/* ── Formulaire ── */}
      {!isLocked && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4">
            Nouveau décaissement
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Date + Montant */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Montant (FCFA) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={montant}
                  onChange={e => setMontant(e.target.value)}
                  placeholder="0"
                  required
                  min="1"
                  step="1"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                />
              </div>
            </div>

            {/* Description + Bouton vocal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
                {sourceVocale && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full font-normal">
                    🎙️ Dicté
                  </span>
                )}
              </label>

              {/* Input + bouton inline */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayedDescription}
                  onChange={handleDescriptionChange}
                  readOnly={isRecording}
                  placeholder={
                    isRecording
                      ? 'Enregistrement en cours...'
                      : 'Description du décaissement'
                  }
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm transition-all ${
                    isRecording
                      ? 'border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-900/10 text-gray-900 dark:text-white cursor-not-allowed'
                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                  }`}
                />

                {/* Bouton vocal — affiche seulement si supporte */}
                {speechSupported === true && (
                  <button
                    type="button"
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={isRecording ? stopRecording : undefined}
                    onTouchStart={e => { e.preventDefault(); startRecording() }}
                    onTouchEnd={stopRecording}
                    onContextMenu={e => e.preventDefault()}
                    title="Maintenez appuyé pour dicter"
                    className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all select-none touch-none ${
                      isRecording
                        ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-300 dark:shadow-red-900/50 scale-110'
                        : 'bg-violet-600 hover:bg-violet-700 shadow-sm hover:shadow-md hover:scale-105'
                    }`}
                  >
                    {isRecording ? <WaveAnimation /> : <MicIcon className="w-5 h-5 text-white" />}
                  </button>
                )}

                {/* Fallback message si non supporte */}
                {speechSupported === false && (
                  <div className="flex-shrink-0 flex items-center">
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                      Voix non disponible
                    </span>
                  </div>
                )}
              </div>

              {/* Hint hold-to-talk */}
              {speechSupported === true && !isRecording && !showConfirm && (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Maintenez le bouton violet pour dicter
                </p>
              )}

              {/* Indicateur enregistrement */}
              {isRecording && (
                <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Enregistrement — relâchez pour terminer
                </div>
              )}

              {/* ── Confirmation transcription ── */}
              {showConfirm && (
                <div className="mt-3 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg">
                  <p className="text-xs font-medium text-violet-800 dark:text-violet-300 mb-2">
                    🎙️ Transcription — vérifiez et modifiez si besoin :
                  </p>
                  <input
                    type="text"
                    value={pendingTranscript}
                    onChange={e => setPendingTranscript(e.target.value)}
                    className="w-full border border-violet-300 dark:border-violet-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent mb-2"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmTranscript}
                      className="flex-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                    >
                      ✓ Utiliser
                    </button>
                    <button
                      type="button"
                      onClick={cancelTranscript}
                      className="flex-1 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                    >
                      ✕ Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Categorie + Compte */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Catégorie
                </label>
                <select
                  value={categorieId}
                  onChange={e => setCategorieId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Sans catégorie</option>
                  {categories.map((c: Categorie) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Compte
                </label>
                <select
                  value={compteId}
                  onChange={e => setCompteId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Sans compte</option>
                  {comptes.map((c: Compte) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Bouton submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enregistrement...
                </>
              ) : (
                'Enregistrer le décaissement'
              )}
            </button>
          </form>
        </div>
      )}

      {/* ── Historique ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Historique</h2>
          {decaissements.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {decaissements.length} entrée{decaissements.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {decaissements.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-gray-400">
                <path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
                <path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" />
                <path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Aucun décaissement enregistré</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {decaissements.map((d: Decaissement) => (
              <div
                key={d.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
              >
                {/* Gauche : info */}
                <div className="flex items-center gap-3 min-w-0">
                  {/* Couleur categorie */}
                  <div
                    className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: d.categorie?.couleur ?? '#9ca3af' }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {d.description || (
                          <span className="italic text-gray-400">Sans description</span>
                        )}
                      </p>
                      {/* Badge vocal */}
                      {d.sourceVocale && (
                        <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded-full">
                          🎙️
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatDate(d.date)}
                      {d.categorie && <span className="ml-1">· {d.categorie.nom}</span>}
                      {d.compte && <span className="ml-1">· {d.compte.nom}</span>}
                    </p>
                  </div>
                </div>

                {/* Droite : montant */}
                <div className="flex-shrink-0 ml-4">
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                    -{formatMontant(d.montant)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
