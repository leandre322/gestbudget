'use client';
import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { formatFCFA, TYPE_LABELS, LABEL_PREVISION, LABEL_REEL } from '@/types';
import { clsx } from 'clsx';

interface Props {
  isOpen:    boolean;
  onClose:   () => void;
  onSave:    (lignes: Record<string, { prevision: string; reel: string }>) => Promise<void>;
  titre:     string;
  categories: any[];
  lignes:    Record<string, { anticipe: string; reel: string }>;
  mode:      'prevision' | 'reel' | 'both';
}

export default function ModalKPI({ isOpen, onClose, onSave, titre, categories, lignes, mode }: Props) {
  const [vals,    setVals]    = useState<Record<string, { prevision: string; reel: string }>>({});
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    if (isOpen) {
      const init: Record<string, { prevision: string; reel: string }> = {};
      for (const cat of categories) {
        init[cat.id] = {
          prevision: lignes[cat.id]?.anticipe ?? '',
          reel:      lignes[cat.id]?.reel     ?? '',
        };
      }
      setVals(init);
    }
  }, [isOpen, categories, lignes]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(vals);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-primary/5">
          <h3 className="font-bold text-[var(--text)]">✏️ Modifier — {titre}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Corps */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-3">
          {/* En-tête colonnes */}
          <div className="grid grid-cols-3 gap-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide pb-2 border-b border-[var(--border)]">
            <span>Catégorie</span>
            {(mode === 'prevision' || mode === 'both') && <span className="text-right">{LABEL_PREVISION}</span>}
            {(mode === 'reel'      || mode === 'both') && <span className="text-right">{LABEL_REEL}</span>}
          </div>

          {categories.map((cat: any) => (
            <div key={cat.id} className="grid grid-cols-3 gap-3 items-center">
              <span className="text-sm text-[var(--text)] truncate">{cat.nom}</span>
              {(mode === 'prevision' || mode === 'both') && (
                <input
                  type="number"
                  value={vals[cat.id]?.prevision ?? ''}
                  onChange={e => setVals(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], prevision: e.target.value } }))}
                  placeholder="0"
                  className="text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none w-full"
                />
              )}
              {(mode === 'reel' || mode === 'both') && (
                <input
                  type="number"
                  value={vals[cat.id]?.reel ?? ''}
                  onChange={e => setVals(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], reel: e.target.value } }))}
                  placeholder="0"
                  className="text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none w-full"
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border)] bg-slate-50 dark:bg-dark-card">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-100 dark:hover:bg-dark-card transition-all">
            Annuler
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary-dark text-white transition-all disabled:opacity-60">
            <Save size={14} />
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}