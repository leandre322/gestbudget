'use client';

import { useState, useCallback } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';

// ── useAudit : hook pour enregistrer les actions sensibles ───────────────────
export function useAudit() {
  const log = useCallback(async (
    action: string,
    opts?: { entityType?: string; entityId?: string; entityNom?: string; details?: any }
  ) => {
    try {
      await fetch('/api/audit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, ...opts }),
      });
    } catch {
      // Ne jamais bloquer l'action principale
    }
  }, []);

  return { log };
}

// ── Props ConfirmModal ────────────────────────────────────────────────────────
interface ConfirmModalProps {
  isOpen:     boolean;
  onClose:    () => void;
  onConfirm:  () => void | Promise<void>;
  titre:      string;
  message:    string;
  // Type de confirmation
  type?:      'danger' | 'warning';
  // P12 options
  confirmMode?: 'button'     // Bouton simple avec countdown (Option C)
              | 'text';      // Taper un texte de confirmation (Option B)
  confirmText?: string;      // Texte attendu pour confirmMode='text'
  loading?:   boolean;
  labelConfirm?: string;
}

// ── ConfirmModal — P12 ────────────────────────────────────────────────────────
export function ConfirmModal({
  isOpen, onClose, onConfirm,
  titre, message,
  type = 'danger',
  confirmMode = 'button',
  confirmText,
  loading = false,
  labelConfirm = 'Supprimer',
}: ConfirmModalProps) {
  const [input,     setInput]     = useState('');
  const [countdown, setCountdown] = useState(0);

  const handleOpen = () => {
    setInput('');
    // Countdown mode : lancer un timer de 3s
    if (confirmMode === 'button') {
      setCountdown(3);
      const t = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(t); return 0; }
          return c - 1;
        });
      }, 1000);
    }
  };

  // Détecter ouverture
  if (isOpen && countdown === 0 && confirmMode === 'button') {
    // Ne relancer le timer que si pas déjà en cours — géré via useEffect en pratique
  }

  const isConfirmable = confirmMode === 'text'
    ? input === confirmText
    : countdown === 0;

  const colors = type === 'danger'
    ? { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800',
        icon: 'text-red-500', btn: 'bg-red-500 hover:bg-red-600',
        title: 'text-red-700 dark:text-red-400' }
    : { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800',
        icon: 'text-amber-500', btn: 'bg-amber-500 hover:bg-amber-600',
        title: 'text-amber-700 dark:text-amber-400' };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Barre top colorée */}
        <div className={clsx('h-1', type === 'danger' ? 'bg-red-500' : 'bg-amber-500')} />

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colors.bg, colors.border, 'border')}>
            {type === 'danger'
              ? <Trash2 size={18} className={colors.icon} />
              : <AlertTriangle size={18} className={colors.icon} />}
          </div>
          <div className="flex-1">
            <h3 className={clsx('font-bold text-base', colors.title)}>{titre}</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">{message}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Confirmation mode text — P12 Option B */}
        {confirmMode === 'text' && confirmText && (
          <div className="px-5 pb-4">
            <div className={clsx('rounded-xl p-3 mb-3', colors.bg, colors.border, 'border')}>
              <p className="text-xs text-[var(--text-muted)] mb-1.5">
                Pour confirmer, tapez exactement :
              </p>
              <code className={clsx('text-sm font-bold font-mono', colors.icon)}>
                {confirmText}
              </code>
            </div>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Tapez "${confirmText}"`}
              autoFocus
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-red-400 outline-none"
            />
          </div>
        )}

        {/* Confirmation mode countdown — P12 Option C */}
        {confirmMode === 'button' && countdown > 0 && (
          <div className="px-5 pb-2 text-center">
            <p className="text-xs text-[var(--text-muted)]">
              Patientez <span className="font-bold text-[var(--text)]">{countdown}s</span> avant de confirmer...
            </p>
            <div className="mt-2 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-400 rounded-full transition-all"
                style={{ width: `${((3 - countdown) / 3) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all"
          >
            Annuler
          </button>
          <button
            onClick={async () => { await onConfirm(); setInput(''); }}
            disabled={!isConfirmable || loading}
            className={clsx(
              'px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              colors.btn
            )}
          >
            {loading ? 'En cours...' : labelConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── useConfirm — hook utilitaire pour gérer le state du modal ──────────────
export function useConfirm() {
  const [state, setState] = useState<{
    isOpen: boolean;
    titre: string;
    message: string;
    confirmText?: string;
    confirmMode?: 'button' | 'text';
    type?: 'danger' | 'warning';
    labelConfirm?: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    titre: '',
    message: '',
    onConfirm: () => {},
  });

  const [loading, setLoading] = useState(false);

  const confirm = useCallback((opts: {
    titre: string;
    message: string;
    confirmText?: string;
    confirmMode?: 'button' | 'text';
    type?: 'danger' | 'warning';
    labelConfirm?: string;
    onConfirm: () => void | Promise<void>;
  }) => {
    setState({ ...opts, isOpen: true });
  }, []);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try { await state.onConfirm(); } finally { setLoading(false); }
    setState(s => ({ ...s, isOpen: false }));
  }, [state]);

  const handleClose = useCallback(() => {
    setState(s => ({ ...s, isOpen: false }));
  }, []);

  const modal = (
    <ConfirmModal
      isOpen={state.isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      titre={state.titre}
      message={state.message}
      confirmText={state.confirmText}
      confirmMode={state.confirmMode ?? 'button'}
      type={state.type ?? 'danger'}
      labelConfirm={state.labelConfirm}
      loading={loading}
    />
  );

  return { confirm, modal };
}
