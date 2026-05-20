'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Save, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import { useMois } from '../layout';
import { formatFCFA, MOIS_LABELS, ORDRE_TYPES, TYPE_LABELS, TYPE_COLORS } from '@/types';
import { clsx } from 'clsx';

type Lignes = Record<string, { anticipe: string; reel: string }>;

const TYPES_OUVERTS_PAR_DEFAUT = ['revenu', 'epargne_precaution'];

export default function SuiviPage() {
  const { mois, annee } = useMois();
  const [data,    setData]    = useState<any>(null);
  const [lignes,  setLignes]  = useState<Lignes>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [copying, setCopying] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (!res.ok) { setLoading(false); return; }
    const d = await res.json();
    setData(d);
    const init: Lignes = {};
    for (const cat of d.categories) {
      const b = d.budget.find((b: any) => b.categorieId === cat.id);
      init[cat.id] = {
        anticipe: b?.montantAnticipe ? String(b.montantAnticipe) : '',
        reel:     b?.montantReel     ? String(b.montantReel)     : '',
      };
    }
    setLignes(init);
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { charger(); }, [charger]);

  const scheduleSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => sauvegarder(), 30000);
  };

  const handleChange = (catId: string, field: 'anticipe'|'reel', val: string) => {
    setLignes(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: val } }));
    scheduleSave();
    setSaved(false);
  };

  const sauvegarder = async () => {
    if (!data?.anneeId) return;
    setSaving(true);
    (window as any).__setSaveStatus?.('saving');
    const res = await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anneeId: data.anneeId, mois, lignes }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      (window as any).__setSaveStatus?.('saved');
      setTimeout(() => { setSaved(false); (window as any).__setSaveStatus?.('idle'); }, 3000);
    } else {
      (window as any).__setSaveStatus?.('error');
    }
  };

  const copierMoisPrecedent = async () => {
    setCopying(true);
    const pm = mois === 1 ? 12 : mois - 1;
    const pa = mois === 1 ? annee - 1 : annee;
    const res = await fetch(`/api/budget?annee=${pa}&mois=${pm}`);
    if (res.ok) {
      const prev = await res.json();
      const newL = { ...lignes };
      for (const b of (prev.budget ?? [])) {
        if (newL[b.categorieId] !== undefined) {
          newL[b.categorieId] = { ...newL[b.categorieId], anticipe: String(b.montantAnticipe) };
        }
      }
      setLignes(newL);
      scheduleSave();
    }
    setCopying(false);
  };

  // Tout plier / déplier (prop. B)
  const toggleAll = (open: boolean) => {
    setAllOpen(open);
    ORDRE_TYPES.forEach(t => localStorage.setItem(`group-suivi-${t}`, String(open)));
    // Forcer le re-render des CollapsibleGroup
    window.dispatchEvent(new StorageEvent('storage', { key: 'group-refresh' }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const cats = data?.categories ?? [];
  const grouped = ORDRE_TYPES.map(type => ({
    type, items: cats.filter((c: any) => c.type === type),
  })).filter(g => g.items.length > 0);

  const totalAnt = cats.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const totalReel= cats.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0);

  const revReel  = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0);
  const epReel   = cats.filter((c: any) => c.type?.startsWith('epargne')).reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0);
  const depReel  = cats.filter((c: any) => c.type?.startsWith('depense') || c.type === 'remboursement_dette').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0);
  const solde    = revReel - epReel - depReel;
  const tauxExec = totalAnt > 0 ? (totalReel / totalAnt) * 100 : 0;
  const tauxEp   = revReel > 0 ? (epReel / revReel) * 100 : 0;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Suivi mensuel</h1>
          <p className="text-[var(--text-muted)] text-sm">{MOIS_LABELS[mois]} {annee}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Tout plier / déplier (prop. B) */}
          <button onClick={() => toggleAll(false)}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={() => toggleAll(true)}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={copierMoisPrecedent} disabled={copying}
            className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Copy size={14} />{copying ? 'Copie...' : 'Mois précédent'}
          </button>
          <button onClick={sauvegarder} disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Save size={14} />{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus',  val: revReel, cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'   },
          { label: 'Épargne',  val: epReel,  cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label: 'Dépenses', val: depReel, cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'       },
          { label: 'Solde',    val: solde,   cls: solde >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 transition-colors', k.cls)}>
            <p className="text-xs font-medium opacity-60">{k.label}</p>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* KPIs analytiques */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <span className="text-primary text-lg">📊</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d'exécution</p>
            <p className="text-xl font-bold text-primary">{tauxExec.toFixed(1)} %</p>
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
            <span className="text-lg">🐷</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d'épargne</p>
            <p className={clsx('text-xl font-bold', tauxEp >= 30 ? 'text-green-600' : tauxEp >= 15 ? 'text-amber-500' : 'text-red-500')}>
              {tauxEp.toFixed(1)} %
            </p>
            <p className="text-xs text-[var(--text-muted)]">Objectif : 30 %</p>
          </div>
        </div>
      </div>

      {/* Tableau avec groupes pliables */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        {/* En-tête fixe */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase tracking-wide w-56">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Anticipé</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Réel</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Écart</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">% Exéc.</th>
              </tr>
            </thead>
          </table>
        </div>

        {/* Groupes pliables */}
        {grouped.map(({ type, items }) => {
          const gAnt  = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
          const gReel = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0);
          const gEcar = gReel - gAnt;
          const gPct  = gAnt > 0 ? (gReel / gAnt) * 100 : 0;
          const isRevenu = type === 'revenu';

          // Sous-total badge (prop. C)
          const badge = `${formatFCFA(gReel)} réel`;
          const badgeColor = gEcar > 0 && !isRevenu ? 'text-red-500' : 'text-green-600 dark:text-green-400';

          return (
            <CollapsibleGroup
              key={type}
              id={`suivi-${type}`}
              label={TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
              badge={badge}
              badgeColor={badgeColor}
              defaultOpen={TYPES_OUVERTS_PAR_DEFAUT.includes(type)}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((cat: any) => {
                      const ant  = parseInt(lignes[cat.id]?.anticipe) || 0;
                      const reel = parseInt(lignes[cat.id]?.reel) || 0;
                      const ecar = reel - ant;
                      const pct  = ant > 0 ? (reel / ant) * 100 : 0;
                      const over = !isRevenu && ant > 0 && reel > ant;
                      return (
                        <tr key={cat.id}
                          className={clsx('border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors',
                            over && 'bg-red-50/30 dark:bg-red-900/10')}>
                          <td className="px-4 py-2.5 w-56 text-[var(--text)]">
                            <span className="flex items-center gap-1.5">
                              {over && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                              {cat.nom}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" value={lignes[cat.id]?.anticipe ?? ''}
                              onChange={e => handleChange(cat.id, 'anticipe', e.target.value)}
                              placeholder="0"
                              className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary focus:ring-1 focus:ring-blue-200 outline-none transition-all" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" value={lignes[cat.id]?.reel ?? ''}
                              onChange={e => handleChange(cat.id, 'reel', e.target.value)}
                              placeholder="0"
                              className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary focus:ring-1 focus:ring-blue-200 outline-none transition-all" />
                          </td>
                          <td className={clsx('px-4 py-2.5 text-right text-sm font-medium',
                            ecar > 0 && !isRevenu ? 'text-red-500' : ecar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                            {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm">
                            {ant > 0 ? (
                              <span className={clsx('font-semibold',
                                pct > 110 ? 'text-red-500' : pct > 100 ? 'text-orange-500' : pct >= 80 ? 'text-amber-500' : 'text-green-500')}>
                                {pct.toFixed(0)} %
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Sous-total */}
                    <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                      <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                      <td className={clsx('px-4 py-2 text-right text-xs font-bold',
                        gEcar > 0 && !isRevenu ? 'text-red-500' : 'text-green-500')}>
                        {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">
                        {gAnt > 0 ? gPct.toFixed(0) + ' %' : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CollapsibleGroup>
          );
        })}

        {/* Total général */}
        <div className="px-4 py-3 border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10 flex items-center">
          <span className="font-bold text-[var(--text)] flex-1">TOTAL GÉNÉRAL</span>
          <span className="font-bold text-[var(--text)] w-40 text-right pr-4">{formatFCFA(totalAnt)}</span>
          <span className="font-bold text-[var(--text)] w-40 text-right pr-4">{formatFCFA(totalReel)}</span>
          <span className="text-[var(--text-muted)] w-32 text-right pr-4">—</span>
          <span className="font-bold text-primary w-20 text-right">{tauxExec.toFixed(0)} %</span>
        </div>
      </div>
    </div>
  );
}
