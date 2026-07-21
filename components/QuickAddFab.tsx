'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, X, Zap, Lock } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { useLock } from '@/app/(app)/contexts';
import { formatFCFA } from '@/types';

// ── Quick Add FAB (S6) ────────────────────────────────────────────────────────
// Saisie en 3 secondes : montant + catégorie → incrémente montantReel
// du MOIS RÉEL COURANT (décidé côté serveur — voir /api/quick-add).
// S'ouvre automatiquement via le shortcut PWA /suivi?quickadd=1.
// Émet l'événement 'quickadd:done' pour que les pages ouvertes se rechargent.
//
// Verrou : respecte le mode lecture seule global (useLock). Quand l'app est
// verrouillée, l'ajout est bloqué tant que la case "insérer malgré le verrou"
// n'est pas cochée (garde-fou anti-saisie accidentelle, sans déverrouiller les
// tableaux du mois affiché).

type Cat = { id: string; nom: string; type: string };

export default function QuickAddFab() {
  const toast = useToast();
  const { isLocked } = useLock();

  const [open,        setOpen]        = useState(false);
  const [flux,        setFlux]        = useState<'decaissement' | 'encaissement'>('decaissement');
  const [montant,     setMontant]     = useState('');
  const [categorieId, setCategorieId] = useState('');
  const [libelle,     setLibelle]     = useState('');
  const [override,    setOverride]    = useState(false); // S6 : forcer malgré le verrou
  const [cats,        setCats]        = useState<Cat[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [sending,     setSending]     = useState(false);

  // ── Ouverture auto via ?quickadd=1 (shortcut PWA "Ajout rapide") ──────────
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('quickadd') === '1') setOpen(true);
    } catch {}
  }, []);

  // ── Charger les catégories actives (lazy : uniquement à l'ouverture) ──────
  const chargerCats = useCallback(async () => {
    setLoadingCats(true);
    try {
      const now = new Date();
      const res = await fetch(`/api/budget?annee=${now.getFullYear()}&mois=${now.getMonth() + 1}`);
      if (res.ok) {
        const d = await res.json();
        setCats((d.categories ?? []).map((c: any) => ({ id: c.id, nom: c.nom, type: c.type })));
      }
    } catch {}
    setLoadingCats(false);
  }, []);

  useEffect(() => {
    if (open && cats.length === 0) chargerCats();
  }, [open, cats.length, chargerCats]);

  // Décaissement → toutes catégories sauf revenu ; Encaissement → revenu uniquement
  const catsFiltrees = cats.filter(c =>
    flux === 'encaissement' ? c.type === 'revenu' : c.type !== 'revenu'
  );

  const fermer = () => {
    setOpen(false);
    setMontant('');
    setLibelle('');
    setCategorieId('');
    setOverride(false);
  };

  const bloqueParVerrou = isLocked && !override;

  const envoyer = async () => {
    const m = parseInt(montant);
    if (bloqueParVerrou) { toast.error('Mode lecture seule — cochez la case pour insérer'); return; }
    if (!m || m <= 0)   { toast.error('Montant invalide'); return; }
    if (!categorieId)   { toast.error('Choisissez une catégorie'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/quick-add', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ montant: m, categorieId, libelle: libelle || null }),
      });
      if (res.ok) {
        const d = await res.json();
        toast.success(`${formatFCFA(m)} → ${d.categorie} ✓`);
        // Les pages ouvertes (suivi) rechargent leur état depuis la DB
        window.dispatchEvent(new CustomEvent('quickadd:done'));
        fermer();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.message ?? "Erreur lors de l'ajout");
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSending(false);
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !sending && !bloqueParVerrou) envoyer();
  };

  return (
    <>
      {/* ── Bouton flottant ── */}
      {!open && (
        <button onClick={() => setOpen(true)} title="Ajout rapide"
          className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-40 w-14 h-14 rounded-full bg-primary hover:bg-primary-dark text-white shadow-lg shadow-primary/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95">
          <Plus size={26} />
        </button>
      )}

      {/* ── Modale minimale ── */}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={fermer} />
          <div className="relative bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm sm:mx-4 overflow-hidden animate-fadeIn">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text)] flex items-center gap-2 text-sm">
                <Zap size={15} className="text-primary" />Ajout rapide — mois courant
              </h3>
              <button onClick={fermer} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Toggle flux */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setFlux('decaissement'); setCategorieId(''); }}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                    flux === 'decaissement'
                      ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]'
                  }`}>
                  Décaissement
                </button>
                <button onClick={() => { setFlux('encaissement'); setCategorieId(''); }}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                    flux === 'encaissement'
                      ? 'border-green-300 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]'
                  }`}>
                  Encaissement
                </button>
              </div>

              {/* Montant */}
              <input
                type="number" inputMode="numeric" autoFocus
                value={montant} onChange={e => setMontant(e.target.value)} onKeyDown={onEnter}
                placeholder="Montant (FCFA)"
                className="w-full text-right text-lg font-semibold border border-[var(--border)] rounded-xl px-3 py-2.5 bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
              />

              {/* Catégorie */}
              <select value={categorieId} onChange={e => setCategorieId(e.target.value)}
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                <option value="">{loadingCats ? 'Chargement…' : '— Catégorie —'}</option>
                {catsFiltrees.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>

              {/* Libellé optionnel */}
              <input
                type="text" maxLength={100}
                value={libelle} onChange={e => setLibelle(e.target.value)} onKeyDown={onEnter}
                placeholder="Libellé (optionnel)"
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
              />

              {/* ── S6 : garde-fou verrou ── */}
              {isLocked && (
                <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                  <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)}
                    className="mt-0.5 accent-amber-500 w-4 h-4 flex-shrink-0" />
                  <span className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                    <Lock size={12} className="mt-0.5 flex-shrink-0" />
                    <span><strong>Mode lecture seule actif.</strong> Cochez pour insérer malgré le verrou (le mois affiché reste verrouillé).</span>
                  </span>
                </label>
              )}

              <button onClick={envoyer} disabled={sending || bloqueParVerrou}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold transition-all disabled:opacity-50">
                <Plus size={15} />{sending ? 'Ajout…' : 'Ajouter'}
              </button>
              <p className="text-[11px] text-[var(--text-muted)] text-center">
                Ajouté au suivi du mois réel en cours · traçé dans l'historique
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
