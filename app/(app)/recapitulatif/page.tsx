'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { Download, FileText } from 'lucide-react';
import { useMois } from '../layout';
import { formatFCFA, MOIS_COURTS, TYPE_LABELS, ORDRE_TYPES } from '@/types';
import { clsx } from 'clsx';

export default function RecapitulatifPage() {
  const { mois, annee } = useMois();
  const [data, setData] = useState<any>(null);
  const [dataComp, setDataComp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'excel'|'pdf'|null>(null);

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (res.ok) setData(await res.json());

    // Année précédente pour comparaison
    const resComp = await fetch(`/api/budget?annee=${annee - 1}&mois=${mois}`);
    if (resComp.ok) setDataComp(await resComp.json());

    setLoading(false);
  }, [annee, mois]);

  useEffect(() => { charger(); }, [charger]);

  const exportExcel = async () => {
    setExporting('excel');
    const res = await fetch(`/api/export/excel?annee=${annee}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `GestBudget-${annee}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(null);
  };

  const exportPDF = async () => {
    setExporting('pdf');
    const res = await fetch(`/api/export/pdf?annee=${annee}&mois=${mois}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `GestBudget-${annee}-${String(mois).padStart(2,'0')}.pdf`; a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const budget = data?.budget ?? [];
  const cats   = data?.categories ?? [];
  const budgetComp = dataComp?.budget ?? [];

  const totAnn = (field: 'montantAnticipe'|'montantReel') =>
    budget.reduce((s: number, b: any) => s + b[field], 0);

  const totType = (type: string, field: 'montantAnticipe'|'montantReel') =>
    budget.filter((b: any) =>
      type === 'epargne' ? b.categorie?.type?.startsWith('epargne') :
      type === 'depense' ? (b.categorie?.type?.startsWith('depense') || b.categorie?.type === 'remboursement_dette') :
      b.categorie?.type === type
    ).reduce((s: number, b: any) => s + b[field], 0);

  const revReel  = totType('revenu', 'montantReel');
  const depReel  = totType('depense', 'montantReel');
  const epReel   = totType('epargne', 'montantReel');
  const solde    = revReel - depReel - epReel;

  const revComp  = budgetComp.filter((b: any) => b.categorie?.type === 'revenu').reduce((s: number, b: any) => s + b.montantReel, 0);

  // Données graphique comparaison
  const chartData = ORDRE_TYPES.slice(4).map(type => {
    const curr = budget.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    const prev = budgetComp.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    return { name: TYPE_LABELS[type].replace('Dépenses ', '').replace(' Dettes', ''), [annee]: curr, [annee-1]: prev };
  }).filter(d => d[annee] > 0 || d[annee-1] > 0);

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Récapitulatif annuel</h1>
          <p className="text-slate-500 text-sm">{annee}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={exporting === 'excel'}
            className="flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Download size={14} />{exporting === 'excel' ? 'Export...' : 'Excel'}
          </button>
          <button onClick={exportPDF} disabled={exporting === 'pdf'}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <FileText size={14} />{exporting === 'pdf' ? 'Export...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* KPIs annuels */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus réels', val: revReel, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Dépenses réelles', val: depReel, cls: 'bg-red-50 border-red-200 text-red-700' },
          { label: 'Épargne réelle', val: epReel, cls: 'bg-green-50 border-green-200 text-green-700' },
          { label: 'Solde', val: solde, cls: solde >= 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-4', k.cls)}>
            <p className="text-xs font-medium opacity-60">{k.label}</p>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Graphique comparaison */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-3">
            Comparaison dépenses — {annee - 1} vs {annee}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v/1000).toFixed(0)+'k'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey={annee-1} name={String(annee-1)} fill="#CBD5E1" radius={[3,3,0,0]} />
              <Bar dataKey={annee}   name={String(annee)}   fill="#1E40AF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tableau récapitulatif par type */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-semibold text-slate-700">Détail par catégorie</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-400 text-xs uppercase">Anticipé</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-400 text-xs uppercase">Réel</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-400 text-xs uppercase">Écart</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-400 text-xs uppercase">% Rev.</th>
              </tr>
            </thead>
            <tbody>
              {ORDRE_TYPES.map(type => {
                const catsDuType = cats.filter((c: any) => c.type === type);
                if (catsDuType.length === 0) return null;
                const gAnt  = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantAnticipe ?? 0); }, 0);
                const gReel = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantReel ?? 0); }, 0);
                const gEcar = gReel - gAnt;
                const pct   = revReel > 0 ? ((gReel / revReel) * 100).toFixed(1) + '%' : '—';

                return (
                  <>
                    <tr key={`h-${type}`} className="bg-slate-50 border-t border-slate-200">
                      <td colSpan={5} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wide">
                        {TYPE_LABELS[type]}
                      </td>
                    </tr>
                    {catsDuType.map((cat: any) => {
                      const b = budget.find((b: any) => b.categorieId === cat.id);
                      const ant  = b?.montantAnticipe ?? 0;
                      const reel = b?.montantReel ?? 0;
                      const ecar = reel - ant;
                      const catPct = revReel > 0 ? ((reel / revReel) * 100).toFixed(1) + '%' : '—';
                      return (
                        <tr key={cat.id} className="border-t border-slate-50 hover:bg-slate-50/40 transition-colors">
                          <td className="px-4 py-2.5 text-slate-700">{cat.nom}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{ant > 0 ? formatFCFA(ant) : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-700">{reel > 0 ? formatFCFA(reel) : '—'}</td>
                          <td className={clsx('px-4 py-2.5 text-right text-xs font-medium',
                            ecar > 0 && type.startsWith('depense') ? 'text-red-500' : ecar < 0 ? 'text-green-500' : 'text-slate-400')}>
                            {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-400">{catPct}</td>
                        </tr>
                      );
                    })}
                    <tr key={`st-${type}`} className="bg-slate-50/80 border-t border-slate-200">
                      <td className="px-4 py-2 text-xs font-bold text-slate-500">Sous-total</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-slate-600">{formatFCFA(gAnt)}</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-slate-700">{formatFCFA(gReel)}</td>
                      <td className={clsx('px-4 py-2 text-right text-xs font-bold',
                        gEcar > 0 && type.startsWith('depense') ? 'text-red-500' : 'text-green-500')}>
                        {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-slate-400">{pct}</td>
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
