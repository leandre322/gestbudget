'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, PiggyBank, Wallet, Star, AlertTriangle, Shield, ChevronDown } from 'lucide-react';
import { useMois } from '../layout';
import { formatFCFA, MOIS_COURTS, TYPE_LABELS, calculerScore, couleurScore, ORDRE_TYPES } from '@/types';
import { clsx } from 'clsx';

const COLORS = ['#1E40AF','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#84CC16'];

// ── Onglet Global ────────────────────────────
function OngletGlobal() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/global').then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;
  if (!data) return null;

  const { totalRevenus, totalDepenses, totalEpargne, solde, evolutionAnnuelle, fondsRoulement, comptes, totalFonds } = data;

  return (
    <div className="space-y-5">
      {/* KPIs cumulés */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Revenus cumulés',   val: totalRevenus,  bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',   text: 'text-blue-700 dark:text-blue-400',   icon: TrendingUp },
          { label: 'Dépenses cumulées', val: totalDepenses, bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',       text: 'text-red-600 dark:text-red-400',     icon: TrendingDown },
          { label: 'Épargne cumulée',   val: totalEpargne,  bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-400', icon: PiggyBank },
          { label: 'Solde net cumulé',  val: solde,         bg: solde >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', text: solde >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400', icon: Wallet },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-4 transition-colors', k.bg)}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              <k.icon size={15} className="opacity-40" />
            </div>
            <p className={clsx('text-xl font-bold', k.text)}>{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Fonds de roulement */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--text)]">Fonds de roulement (épargnes cumulées)</h3>
          <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {fondsRoulement.map((f: any) => (
            <div key={f.id} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 text-center">
              <p className="text-xs text-[var(--text-muted)] font-medium truncate">{f.nom}</p>
              <p className="text-base font-bold text-primary mt-1">{formatFCFA(f.totalAuto)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">cumul auto</p>
            </div>
          ))}
        </div>
        {/* Total */}
        <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Total fonds de roulement</span>
          <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
        </div>
      </div>

      {/* Évolution annuelle */}
      {evolutionAnnuelle.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-4">Évolution annuelle</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={evolutionAnnuelle} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="annee" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000000).toFixed(1)+'M'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey="revenus"  name="Revenus"  fill="#1E40AF" radius={[3,3,0,0]} />
              <Bar dataKey="depenses" name="Dépenses" fill="#EF4444" radius={[3,3,0,0]} />
              <Bar dataKey="epargne"  name="Épargne"  fill="#10B981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Onglet Récap année ───────────────────────
function OngletRecap() {
  const anneeActuelle = new Date().getFullYear();
  const [anneeSelect, setAnneeSelect] = useState(anneeActuelle);
  const { mois } = useMois();
  const [data,     setData]     = useState<any>(null);
  const [dataComp, setDataComp] = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState<'excel'|'pdf'|null>(null);
  const [anneesDispos, setAnneesDispos] = useState<number[]>([anneeActuelle]);

  useEffect(() => {
    fetch('/api/dashboard/global').then(r => r.json()).then(d => {
      if (d.annees?.length) setAnneesDispos(d.annees);
    });
  }, []);

  const charger = useCallback(async () => {
    setLoading(true);
    const [r, rc] = await Promise.all([
      fetch(`/api/budget?annee=${anneeSelect}&mois=${mois}`),
      fetch(`/api/budget?annee=${anneeSelect - 1}&mois=${mois}`),
    ]);
    if (r.ok)  setData(await r.json());
    if (rc.ok) setDataComp(await rc.json());
    setLoading(false);
  }, [anneeSelect, mois]);

  useEffect(() => { charger(); }, [charger]);

  const exportExcel = async () => {
    setExporting('excel');
    const res = await fetch(`/api/export/excel?annee=${anneeSelect}`);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `GestBudget-${anneeSelect}.xlsx`; a.click();
    }
    setExporting(null);
  };

  const exportPDF = async () => {
    setExporting('pdf');
    const res = await fetch(`/api/export/pdf?annee=${anneeSelect}&mois=${mois}`);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `GestBudget-${anneeSelect}-${String(mois).padStart(2,'0')}.pdf`; a.click();
    }
    setExporting(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const budget = data?.budget ?? [];
  const cats   = data?.categories ?? [];
  const budgetComp = dataComp?.budget ?? [];

  const totType = (type: string, field: 'montantAnticipe'|'montantReel') =>
    budget.filter((b: any) =>
      type === 'epargne' ? b.categorie?.type?.startsWith('epargne') :
      type === 'depense' ? (b.categorie?.type?.startsWith('depense') || b.categorie?.type === 'remboursement_dette') :
      b.categorie?.type === type
    ).reduce((s: number, b: any) => s + b[field], 0);

  const revReel  = totType('revenu','montantReel');
  const depReel  = totType('depense','montantReel');
  const epReel   = totType('epargne','montantReel');
  const solde    = revReel - depReel - epReel;

  // Fonds de roulement (catégories epargne_autre)
  const fondsCategories = cats.filter((c: any) => c.type === 'epargne_autre');
  const totalFonds = fondsCategories.reduce((s: number, cat: any) => {
    const b = budget.find((b: any) => b.categorieId === cat.id);
    return s + (b?.montantReel ?? 0);
  }, 0);

  // Comparaison
  const chartData = ORDRE_TYPES.slice(4).map(type => {
    const curr = budget.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    const prev = budgetComp.filter((b: any) => b.categorie?.type === type).reduce((s: number, b: any) => s + b.montantReel, 0);
    return { name: TYPE_LABELS[type].replace('Dépenses ', '').replace(' Dettes',''), [anneeSelect]: curr, [anneeSelect-1]: prev };
  }).filter((d: any) => d[anneeSelect] > 0 || d[anneeSelect-1] > 0);

  return (
    <div className="space-y-5">
      {/* Sélecteur d'année + exports */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-muted)]">Année :</span>
          <div className="flex gap-1">
            {anneesDispos.map(a => (
              <button key={a} onClick={() => setAnneeSelect(a)}
                className={clsx('px-3 py-1.5 rounded-xl text-sm font-semibold transition-all',
                  anneeSelect === a ? 'bg-primary text-white' : 'border border-[var(--border)] text-[var(--text-muted)] hover:border-primary hover:text-primary')}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={exporting === 'excel'}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card disabled:opacity-60">
            ⬇ {exporting === 'excel' ? 'Export...' : 'Excel'}
          </button>
          <button onClick={exportPDF} disabled={exporting === 'pdf'}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            📄 {exporting === 'pdf' ? 'Export...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus réels',   val: revReel, cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label: 'Dépenses réelles',val: depReel, cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label: 'Épargne réelle',  val: epReel,  cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label: 'Solde',           val: solde,   cls: solde >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 transition-colors', k.cls)}>
            <p className="text-xs font-medium opacity-60">{k.label}</p>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Fonds de roulement */}
      {fondsCategories.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-[var(--text)]">Fonds de fonctionnement {anneeSelect}</h3>
            <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {fondsCategories.map((cat: any) => {
              const b = budget.find((b: any) => b.categorieId === cat.id);
              const val = b?.montantReel ?? 0;
              return (
                <div key={cat.id} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 text-center">
                  <p className="text-xs text-[var(--text-muted)] font-medium truncate">{cat.nom}</p>
                  <p className="text-base font-bold text-primary mt-1">{formatFCFA(val)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Graphique comparaison */}
      {chartData.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3">{anneeSelect - 1} vs {anneeSelect}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000).toFixed(0)+'k'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey={anneeSelect-1} name={String(anneeSelect-1)} fill="#CBD5E1" radius={[3,3,0,0]} />
              <Bar dataKey={anneeSelect}   name={String(anneeSelect)}   fill="#1E40AF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tableau détail */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card">
          <h3 className="font-semibold text-[var(--text)]">Détail par catégorie — {anneeSelect}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Anticipé</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Réel</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Écart</th>
              </tr>
            </thead>
            <tbody>
              {ORDRE_TYPES.map(type => {
                const catsDuType = cats.filter((c: any) => c.type === type);
                if (!catsDuType.length) return null;
                const gAnt  = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantAnticipe ?? 0); }, 0);
                const gReel = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantReel ?? 0); }, 0);
                return (
                  <>
                    <tr key={`h-${type}`} className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                      <td colSpan={4} className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{TYPE_LABELS[type]}</td>
                    </tr>
                    {catsDuType.map((cat: any) => {
                      const b = budget.find((b: any) => b.categorieId === cat.id);
                      const ant  = b?.montantAnticipe ?? 0;
                      const reel = b?.montantReel ?? 0;
                      const ecar = reel - ant;
                      return (
                        <tr key={cat.id} className="border-t border-[var(--border)] hover:bg-slate-50/40 dark:hover:bg-dark-card/40 transition-colors">
                          <td className="px-4 py-2.5 text-[var(--text)]">{cat.nom}</td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{ant > 0 ? formatFCFA(ant) : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-[var(--text)]">{reel > 0 ? formatFCFA(reel) : '—'}</td>
                          <td className={clsx('px-4 py-2.5 text-right text-xs font-medium',
                            ecar > 0 && type.startsWith('depense') ? 'text-red-500' : ecar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                            {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    <tr key={`st-${type}`} className="border-t border-[var(--border)] bg-slate-50/60 dark:bg-dark-card/60">
                      <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)]">Sous-total</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                      <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                      <td className={clsx('px-4 py-2 text-right text-xs font-bold', (gReel-gAnt) > 0 && type.startsWith('depense') ? 'text-red-500' : 'text-green-500')}>
                        {(gReel-gAnt) !== 0 ? ((gReel-gAnt) > 0 ? '+' : '') + formatFCFA(gReel-gAnt) : '—'}
                      </td>
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

// ── Page principale Dashboard ────────────────
export default function DashboardPage() {
  const { mois, annee } = useMois();
  const [onglet, setOnglet] = useState<'global'|'recap'>('global');
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hist,    setHist]    = useState<any[]>([]);

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (!res.ok) { setLoading(false); return; }
    const d = await res.json();
    setData(d);
    // Historique 6 mois
    const histData = [];
    for (let i = 5; i >= 0; i--) {
      let m = mois - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      const hr = await fetch(`/api/budget?annee=${a}&mois=${m}`);
      if (!hr.ok) { histData.push({ mois: MOIS_COURTS[m], ant: 0, reel: 0 }); continue; }
      const hd = await hr.json();
      histData.push({
        mois: MOIS_COURTS[m],
        ant:  hd.budget.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + b.montantAnticipe, 0),
        reel: hd.budget.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + b.montantReel, 0),
      });
    }
    setHist(histData);
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { if (onglet === 'global') {} else charger(); }, [onglet, charger]);
  useEffect(() => { charger(); }, [charger]);

  const budget     = data?.budget ?? [];
  const anneeData  = data?.anneeData;

  const tot = (type: string, f: 'montantAnticipe'|'montantReel') =>
    budget.filter((b: any) => type==='epargne'?b.categorie?.type?.startsWith('epargne'):type==='depense'?(b.categorie?.type?.startsWith('depense')||b.categorie?.type==='remboursement_dette'):b.categorie?.type===type).reduce((s: number, b: any) => s + b[f], 0);

  const revenus  = { reel: tot('revenu','montantReel'),  ant: tot('revenu','montantAnticipe')  };
  const epargne  = { reel: tot('epargne','montantReel'), ant: tot('epargne','montantAnticipe') };
  const depenses = { reel: tot('depense','montantReel'), ant: tot('depense','montantAnticipe') };
  const solde    = revenus.reel - epargne.reel - depenses.reel;
  const fondsUrgence  = budget.filter((b: any) => b.categorie?.type === 'epargne_precaution').reduce((s: number, b: any) => s + b.montantReel, 0);
  const fondsObjectif = Number(anneeData?.fondsUrgenceObjectif ?? 3720000);
  const { score, details } = calculerScore({ totalDepenses: depenses.reel, totalDepAnt: depenses.ant, totalEpargne: epargne.reel, totalRevenus: revenus.reel, solde, fondsUrgence, fondsObjectif });
  const alertes = budget.filter((b: any) => b.categorie?.type?.startsWith('depense') && b.montantAnticipe > 0 && b.montantReel > b.montantAnticipe).map((b: any) => b.categorie?.nom);
  const donut = Object.entries(budget.filter((b: any) => b.categorie?.type?.startsWith('depense') && b.montantReel > 0).reduce((acc: any, b: any) => { const k = b.categorie?.sousType ?? 'Autre'; acc[k] = (acc[k] ?? 0) + b.montantReel; return acc; }, {})).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Tableau de bord</h1>
        <p className="text-[var(--text-muted)] text-sm">{new Date(annee, mois-1).toLocaleString('fr-FR',{month:'long',year:'numeric'})}</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit">
        {([['global','🌍 Global'],['recap','📋 Récapitulatif']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setOnglet(key)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              onglet === key ? 'bg-white dark:bg-dark-surface text-primary shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
          </button>
        ))}
      </div>

      {/* Contenu selon onglet */}
      {onglet === 'global' ? (
        <OngletGlobal />
      ) : (
        <OngletRecap />
      )}

      {/* Section mois courant — toujours visible */}
      {onglet === 'global' && (
        <div className="space-y-5">
          <div className="border-t border-[var(--border)] pt-5">
            <h2 className="font-semibold text-[var(--text)] mb-3 text-sm text-[var(--text-muted)] uppercase tracking-wide">
              Mois courant — {new Date(annee, mois-1).toLocaleString('fr-FR',{month:'long',year:'numeric'})}
            </h2>
          </div>

          {alertes.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3.5 flex items-start gap-2.5">
              <AlertTriangle size={17} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400 text-sm">Dépassements détectés</p>
                <p className="text-red-500 dark:text-red-400 text-sm">{alertes.join(' · ')}</p>
              </div>
            </div>
          )}

          {loading ? <div className="flex items-center justify-center h-32"><div className="spinner" /></div> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  { titre: 'Revenus',  val: revenus.reel,  ant: revenus.ant,  bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',   text: 'text-blue-700 dark:text-blue-400',   icon: TrendingUp },
                  { titre: 'Dépenses', val: depenses.reel, ant: depenses.ant, bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',       text: 'text-red-600 dark:text-red-400',     icon: TrendingDown },
                  { titre: 'Épargne',  val: epargne.reel,  ant: epargne.ant,  bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-400', icon: PiggyBank },
                  { titre: 'Solde',    val: solde,         ant: revenus.ant - epargne.ant - depenses.ant, bg: solde>=0?'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800':'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', text: solde>=0?'text-green-700 dark:text-green-400':'text-red-600 dark:text-red-400', icon: Wallet },
                ].map(k => (
                  <div key={k.titre} className={clsx('rounded-2xl border p-4 flex flex-col gap-2 transition-colors', k.bg)}>
                    <div className="flex items-center justify-between"><p className="text-xs font-medium opacity-60">{k.titre}</p><k.icon size={15} className="opacity-40" /></div>
                    <p className={clsx('text-xl font-bold', k.text)}>{formatFCFA(k.val)}</p>
                    <p className="text-xs opacity-60">Anticipé : {formatFCFA(k.ant)}</p>
                  </div>
                ))}
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 col-span-2 lg:col-span-1 transition-colors">
                  <p className="text-xs font-medium text-purple-500 dark:text-purple-400 mb-1">Score financier</p>
                  <p className={clsx('text-2xl font-bold', couleurScore(score))}>{score}<span className="text-sm text-[var(--text-muted)] font-normal">/20</span></p>
                  <div className="mt-2 space-y-1">
                    {details.map((d: any) => (
                      <div key={d.label} className="h-1 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full', d.pts>=d.max?'bg-green-500':d.pts>=d.max/2?'bg-amber-400':'bg-red-400')} style={{width:`${(d.pts/d.max)*100}%`}} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-5">
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
                  <h3 className="font-semibold text-[var(--text)] mb-3">Répartition dépenses</h3>
                  {donut.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart><Pie data={donut} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={2}>
                        {donut.map((_: any, i: number) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                      </Pie><Tooltip formatter={(v: number) => formatFCFA(v)} /><Legend iconType="circle" iconSize={8} /></PieChart>
                    </ResponsiveContainer>
                  ) : <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">Aucune dépense ce mois</div>}
                </div>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
                  <h3 className="font-semibold text-[var(--text)] mb-3">Dépenses — 6 derniers mois</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hist} barGap={3}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="mois" tick={{fontSize:11,fill:'var(--text-muted)'}} />
                      <YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>(v/1000).toFixed(0)+'k'} />
                      <Tooltip formatter={(v:number)=>formatFCFA(v)} />
                      <Legend />
                      <Bar dataKey="ant"  name="Anticipé" fill="#DBEAFE" radius={[3,3,0,0]} />
                      <Bar dataKey="reel" name="Réel"     fill="#1E40AF" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[var(--text)]">Fonds d'urgence</h3>
                  <Shield size={17} className="text-primary" />
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium text-[var(--text)]">{formatFCFA(fondsUrgence)}</span>
                  <span className="text-[var(--text-muted)]">Objectif : {formatFCFA(fondsObjectif)}</span>
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{width:`${Math.min(100,(fondsUrgence/fondsObjectif)*100)}%`}} />
                </div>
                <p className="text-right text-xs text-[var(--text-muted)] mt-1">{((fondsUrgence/fondsObjectif)*100).toFixed(1)} %</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
