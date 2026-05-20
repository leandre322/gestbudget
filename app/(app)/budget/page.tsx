'use client';

import { useEffect, useState, useCallback } from 'react';
import { Save, Copy, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import { formatFCFA, ORDRE_TYPES, TYPE_LABELS } from '@/types';
import { clsx } from 'clsx';
import { useMois } from '../layout';

const TYPES_OUVERTS = ['revenu', 'epargne_precaution'];

export default function BudgetPage() {
  const { mois, annee } = useMois();
  const [data,    setData]    = useState<any>(null);
  const [lignes,  setLignes]  = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [nextM,   setNextM]   = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (res.ok) {
      const d = await res.json();
      setData(d);
      const init: Record<string, string> = {};
      for (const cat of d.categories) {
        const b = d.budget.find((b: any) => b.categorieId === cat.id);
        init[cat.id] = b?.montantAnticipe ? String(b.montantAnticipe) : '';
      }
      setLignes(init);
    }
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { charger(); }, [charger]);

  const sauvegarder = async () => {
    if (!data?.anneeId) return;
    setSaving(true);
    const lignesFormatted: Record<string, { anticipe: string; reel: string }> = {};
    for (const [catId, val] of Object.entries(lignes)) {
      const b = data.budget.find((b: any) => b.categorieId === catId);
      lignesFormatted[catId] = { anticipe: val, reel: String(b?.montantReel ?? 0) };
    }
    await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anneeId: data.anneeId, mois, lignes: lignesFormatted }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const copierVersProchainMois = async () => {
    const nm = mois === 12 ? 1 : mois + 1;
    const na = mois === 12 ? annee + 1 : annee;
    const resNext = await fetch(`/api/budget?annee=${na}&mois=${nm}`);
    if (!resNext.ok) return;
    const dNext = await resNext.json();
    if (!dNext.anneeId) return;
    const lignesNext: Record<string, { anticipe: string; reel: string }> = {};
    for (const [catId, val] of Object.entries(lignes)) {
      lignesNext[catId] = { anticipe: val, reel: '0' };
    }
    await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anneeId: dNext.anneeId, mois: nm, lignes: lignesNext }),
    });
    setNextM(true);
    setTimeout(() => setNextM(false), 3000);
  };

  const toggleAll = (open: boolean) => {
    ORDRE_TYPES.forEach(t => localStorage.setItem(`group-budget-${t}`, String(open)));
    window.dispatchEvent(new StorageEvent('storage', { key: 'group-refresh' }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const cats = data?.categories ?? [];
  const grouped = ORDRE_TYPES.map(type => ({
    type, items: cats.filter((c: any) => c.type === type),
  })).filter(g => g.items.length > 0);

  const total = cats.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Budget mensuel de référence</h1>
          <p className="text-[var(--text-muted)] text-sm">Montants anticipés — base de planification</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => toggleAll(false)}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={() => toggleAll(true)}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={copierVersProchainMois}
            className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card">
            <Copy size={14} />{nextM ? 'Copié ✓' : '→ Mois suivant'}
          </button>
          <button onClick={sauvegarder} disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Save size={14} />{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Montant anticipé (FCFA)</th>
              </tr>
            </thead>
          </table>
        </div>

        {grouped.map(({ type, items }) => {
          const sousTotal = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
          return (
            <CollapsibleGroup
              key={type}
              id={`budget-${type}`}
              label={TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
              badge={formatFCFA(sousTotal)}
              badgeColor="text-primary dark:text-blue-400"
              defaultOpen={TYPES_OUVERTS.includes(type)}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((cat: any) => (
                      <tr key={cat.id} className="border-t border-[var(--border)] hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                        <td className="px-4 py-2.5 text-[var(--text)]">{cat.nom}</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" value={lignes[cat.id] ?? ''}
                            onChange={e => setLignes(l => ({...l, [cat.id]: e.target.value}))}
                            placeholder="0"
                            className="w-40 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-all" />
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                      <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(sousTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CollapsibleGroup>
          );
        })}

        <div className="px-4 py-3 border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10 flex items-center justify-between">
          <span className="font-bold text-[var(--text)]">TOTAL GÉNÉRAL</span>
          <span className="font-bold text-primary">{formatFCFA(total)}</span>
        </div>
      </div>
    </div>
  );
}
