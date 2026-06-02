'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { Download, FileText, Lock } from 'lucide-react';
import { useMois, useLock } from '../layout';
import { formatFCFA, TYPE_LABELS, ORDRE_TYPES } from '@/types';
import { clsx } from 'clsx';

export default function RecapitulatifPage() {
  const { mois, annee } = useMois();
  const { isLocked } = useLock();

  const [data,      setData]      = useState<any>(null);
  const [dataComp,  setDataComp]  = useState<any>(null);
  const [loading,   setLoading]   = useState(true);
  const [exporting, setExporting] = useState<'excel'|'pdf'|null>(null);

  const charger = useCallback(async () => {
    setLoading(true);
    const [res, resComp] = await Promise.all([
      fetch(`/api/budget?annee=${annee}&mois=${mois}`),
      fetch(`/api/budget?annee=${annee - 1}&mois=${mois}`),
    ]);
    if (res.ok)     setData(await res.json());
    if (resComp.ok) setDataComp(await resComp.json());
    setLoading(false);
  }, [annee, mois]);

  useEffect(() => { charger(); }, [charger]);

  const exportExcel = async () => {
    if (isLocked) return;
    setExporting('excel');
    const res = await fetch(`/api/export/excel?annee=${annee}`);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `GestBudget-${annee}.xlsx`; a.click();
      URL.revokeObjectURL(a.href);
    }
    setExporting(null);
  };

  const exportPDF = async () => {
    if (isLocked) return;
    setExporting('pdf');
    const res = await fetch(`/api/export/pdf?annee=${annee}&mois=${mois}`);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `GestBudget-${annee}-${String(mois).padStart(2,'0')}.pdf`; a.click();
      URL.revokeObjectURL(a.href);
    }
    setExporting(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;

  const budget     = data?.budget ?? [];
  const cats       = data?.categories ?? [];
  const budgetComp = dataComp?.budget ?? [];

  const totType = (type: string, field: 'montantAnticipe'|'montantReel') =>
    budget.filter((b: any) =>
      type === 'epargne' ? b.categorie?.type?.startsWith('epargne') :
      type === 'depense' ? (b.categorie?.type?.startsWith('depense') || b.categorie?.type === 'remboursement_dette') :
      b.categorie?.type === type
    ).reduce((s: number, b: any) => s + b[field], 0);

  const revReel = totType('revenu', 'montantReel');
  const depReel = totType('depense', 'montantReel');
  const epReel  = totType('epargne', 'montantReel');
  const solde   = revReel - depReel - epReel;

  const chartData = ORDRE_TYPES.slice(4).map(type => {
    const curr = budget.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    const prev = budgetComp.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    return { name: TYPE_LABELS[type].replace('Dépenses ', '').replace(' Dettes', ''), [annee]: curr, [annee-1]: prev };
  }).filter(d => d[annee] > 0 || d[annee-1] > 0);

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Récapitulatif annuel</h1>
          <p className="text-[var(--text-muted)] text-sm">{annee}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={exporting === 'excel' || isLocked}
            title={isLocked ? 'Verrouillez pour exporter' : undefined}
            className={clsx('flex items-center gap-2 border rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60',
              isLocked ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] cursor-not-allowed'
                       : 'border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)]')}>
            {isLocked ? <Lock size={13}/> : <Download size={14}/>}
            {exporting === 'excel' ? 'Export...' : 'Excel'}
          </button>
          <button onClick={exportPDF} disabled={exporting === 'pdf' || isLocked}
            title={isLocked ? 'Verrouillez pour exporter' : undefined}
            className={clsx('flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60',
              isLocked ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                       : 'bg-primary hover:bg-primary-dark text-white')}>
            {isLocked ? <Lock size={13}/> : <FileText size={14}/>}
            {exporting === 'pdf' ? 'Export...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* KPIs annuels — 4 avec épargne */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label:`Revenus ${annee}`,  val:revReel, cls:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label:`Dépenses ${annee}`, val:depReel, cls:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label:`Épargne ${annee}`,  val:epReel,  cls:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label:'Solde annuel', val:solde,
            cls:solde >= 0 ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400'
                           : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-4', k.cls)}>
            <p className="text-xs font-medium opacity-60">{k.label}</p>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Graphique comparaison N-1 vs N */}
      {chartData.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3">Comparaison dépenses — {annee - 1} vs {annee}</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}/>
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000).toFixed(0)+'k'}/>
              <Tooltip formatter={(v: number) => formatFCFA(v)}
                contentStyle={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'12px' }}/>
              <Legend/>
              <Bar dataKey={annee-1} name={String(annee-1)} fill="#CBD5E1" radius={[3,3,0,0]}/>
              <Bar dataKey={annee}   name={String(annee)}   fill="#1E40AF" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tableau récapitulatif par catégorie */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card">
          <h3 className="font-semibold text-[var(--text)]">Détail par catégorie</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Anticipé</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Réel</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Écart</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">% Rev.</th>
              </tr>
            </thead>
            <tbody>
              {ORDRE_TYPES.map(type => {
                const catsDuType = cats.filter((c: any) => c.type === type);
                if (!catsDuType.length) return null;
                const gAnt  = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantAnticipe ?? 0); }, 0);
                const gReel = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantReel ?? 0); }, 0);
                const gEcar = gReel - gAnt;
                const pct   = revReel > 0 ? ((gReel / revReel) * 100).toFixed(1) + '%' : '—';
                return (
                  <>
                    <tr key={`h-${type}`} className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                      <td colSpan={5} className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">
                        {TYPE_LABELS[type]}
                      </td>
                    </tr>
                    {catsDuType.map((cat: any) => {
                      const b    = budget.find((b: any) => b.categorieId === cat.id);
                      const ant  = b?.montantAnticipe ?? 0;
                      const reel = b?.montantReel ?? 0;
                      const ecar = reel - ant;
                      const catPct = revReel > 0 ? ((reel / revReel) * 100).toFixed(1) + '%' : '—';
                      return (
                        <tr key={cat.id} className="border-t border-[var(--border)] hover:bg-slate-50/40 dark:hover:bg-dark-card/40 transition-colors">
                          <td className="px-4 py-2.5 text-[var(--text)]">{cat.nom}</td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{ant > 0 ? formatFCFA(ant) : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-[var(--text)]">{reel > 0 ? formatFCFA(reel) : '—'}</td>
                          <td className={clsx('px-4 py-2.5 text-right text-xs font-medium',
                            ecar > 0 && type.startsWith('depense') ? 'text-red-500' : ecar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                            {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-[var(--text-muted)]">{catPct}</td>
                        </tr>
                      );
                    })}
                    <tr key={`st-${type}`} className="bg-slate-50/80 dark:bg-dark-card/80 border-t border-[var(--border)]">
                      <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)]">Sous-total</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                      <td className={clsx('px-4 py-2 text-right text-xs font-bold',
                        gEcar > 0 && type.startsWith('depense') ? 'text-red-500' : 'text-green-500')}>
                        {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">{pct}</td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
