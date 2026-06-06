'use client';

import { useState } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { clsx } from 'clsx';
import { formatFCFA } from '@/types';

interface EnveloppeItem {
  id:               string;
  nom:              string;
  montantReference: number;
  enveloppeActive:  boolean;
}

interface GlissementModalProps {
  fromId:      string;
  fromNom:     string;
  disponible:  number;
  enveloppes:  EnveloppeItem[];
  onClose:     () => void;
  onSuccess:   () => void;
}

export default function GlissementModal({
  fromId, fromNom, disponible, enveloppes, onClose, onSuccess,
}: GlissementModalProps) {
  const [toId,    setToId]    = useState('');
  const [montant, setMontant] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const cibles = enveloppes.filter(e => e.id !== fromId && e.enveloppeActive);

  async function submit() {
    setError('');
    if (!toId)    return setError('Choisissez une catégorie cible');
    if (!montant) return setError('Saisissez un montant');

    const m = parseInt(montant, 10);
    if (isNaN(m) || m <= 0)     return setError('Montant invalide');
    if (m > disponible)          return setError(`Maximum disponible : ${formatFCFA(disponible)}`);

    setLoading(true);
    try {
      const res = await fetch('/api/enveloppes/glissement', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fromId, toId, montant: m }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Erreur serveur'); return; }
      onSuccess();
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--border)]">
          <ArrowRightLeft size={15} className="text-primary flex-shrink-0" />
          <h3 className="font-bold text-[var(--text)] text-sm flex-1">Glissement d'enveloppe</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Source */}
          <div className="rounded-xl bg-primary/8 dark:bg-primary/12 px-3 py-2.5 text-xs">
            <span className="text-[var(--text-muted)]">De : </span>
            <span className="font-bold text-primary">{fromNom}</span>
            <span className="ml-2 text-[var(--text-muted)]">
              — disponible : <span className="font-semibold text-[var(--text)]">{formatFCFA(disponible)}</span>
            </span>
          </div>

          {/* Cible */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
              Vers la catégorie
            </label>
            <select
              value={toId}
              onChange={e => setToId(e.target.value)}
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-colors"
            >
              <option value="">— Choisir —</option>
              {cibles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.nom} (budget : {formatFCFA(c.montantReference)})
                </option>
              ))}
            </select>
          </div>

          {/* Montant */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
              Montant à glisser (FCFA)
            </label>
            <input
              type="number"
              min={1}
              max={disponible}
              value={montant}
              onChange={e => setMontant(e.target.value)}
              placeholder={`Max ${formatFCFA(disponible)}`}
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-colors"
            />
          </div>

          {/* Erreur */}
          {error && (
            <p className="text-xs text-red-500 font-medium bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all"
            >
              Annuler
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className={clsx(
                'flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all',
                'bg-primary hover:bg-primary-dark text-white',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {loading ? 'En cours...' : 'Valider'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
