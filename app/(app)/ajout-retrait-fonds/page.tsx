'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Save, ArrowUpCircle, ArrowDownCircle, Trash2,
  Building2, Info, ChevronDown, BarChart2, TrendingUp,
  Target, Loader2, X,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ConfirmModal, useAudit } from '@/components/ConfirmModal';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

// ── Bloquer les caractères non numériques ─────────────────────────────────────
const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const ok = ['Backspace','Delete','Tab','Escape','Enter',
               'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (ok.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/\d/.test(e.key)) e.preventDefault();
};

type Mouvement = 'ajout' | 'retrait';
const PAGE_SIZE = 20; // P14 : pagination

export default function AjoutRetraitFondsPage() {
  const toast = useToast();
  const { log } = useAudit(); // P11

  const [comptes,       setComptes]       = useState<any[]>([]);
  const [banques,       setBanques]       = useState<any[]>([]);
  const [historique,    setHistorique]    = useState<any[]>([]);
  const [histTotal,     setHistTotal]     = useState(0); // P14
  const [histPage,      setHistPage]      = useState(0); // P14
  const [loadingHist,   setLoadingHist]   = useState(false); // P14
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  // P12 — Confirmation suppression
  const [deleteId,      setDeleteId]      = useState<string|null>(null);
  const [deleteDesc,    setDeleteDesc]    = useState('');
  // P7 — Objectif fond
  const [editObjectif,  setEditObjectif]  = useState<{id:string;nom:string;objectif:number}|null>(null);
  const [objVal,        setObjVal]        = useState('');
  const [savingObj,     setSavingObj]     = useState(false);
  // P6 — Graphique évolution
  const [showChart,     setShowChart]     = useState(false);
  const [chartFondId,   setChartFondId]   = useState<string|null>(null);
  const [chartData,     setChartData]     = useState<any>(null);
  const [chartLoading,  setChartLoading]  = useState(false);
  // Onglets
  const [activeTab,     setActiveTab]     = useState<'form'|'historique'>('form');

  const today = new Date().toISOString().split('T')[0];
  const [type,           setType]           = useState<Mouvement>('ajout');
  const [compteId,       setCompteId]       = useState('');
  const [montantFond,    setMontantFond]     = useState('');
  const [montantBanque,  setMontantBanque]   = useState('');
  const [montantTotal,   setMontantTotal]    = useState('');
  const [dateOp,         setDateOp]         = useState(today);
  const [note,           setNote]           = useState('');
  const [banqueId,       setBanqueId]       = useState('');
  const [impacterBanque, setImpacterBanque] = useState(false);

  // ── Chargement ───────────────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [rComptes, rBanques] = await Promise.all([
        fetch('/api/comptes'),
        fetch('/api/banques'),
      ]);
      if (rComptes.ok) {
        const d = await rComptes.json();
        setComptes(d.comptes ?? []);
        if (!compteId && d.comptes?.length) setCompteId(d.comptes[0].id);
      }
      if (rBanques.ok) { const d = await rBanques.json(); setBanques(d.banques ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── P14 : Chargement paginé de l'historique ───────────────────────────────
  const chargerHistorique = useCallback(async (page = 0, append = false) => {
    setLoadingHist(true);
    try {
      const res = await fetch(`/api/decaissements?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
      if (res.ok) {
        const d = await res.json();
        const items = d.decaissements ?? [];
        setHistorique(prev => append ? [...prev, ...items] : items);
        setHistTotal(d.total ?? items.length);
        setHistPage(page);
      }
    } catch {}
    setLoadingHist(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    if (activeTab === 'historique') chargerHistorique(0);
  }, [activeTab, chargerHistorique]);

  // ── P6 : Graphique évolution fond ─────────────────────────────────────────
  const chargerEvolution = async (fondId: string) => {
    if (chartFondId === fondId && showChart) { setShowChart(false); return; }
    setChartFondId(fondId); setShowChart(true); setChartLoading(true);
    try {
      const res = await fetch(`/api/comptes/evolution?id=${fondId}`);
      if (res.ok) setChartData(await res.json());
    } catch {}
    setChartLoading(false);
  };

  // ── P7 : Sauvegarder objectif fond ────────────────────────────────────────
  const sauvegarderObjectif = async () => {
    if (!editObjectif) return;
    setSavingObj(true);
    const newObj = parseInt(objVal) || 0;
    // P8 : mise à jour optimiste
    setComptes(prev => prev.map(c => c.id === editObjectif.id ? { ...c, objectif: newObj } : c));
    try {
      await fetch(`/api/comptes?id=${editObjectif.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectif: newObj }),
      });
      // P11 : log
      await log('update_objectif_fond', { entityType: 'compte_fonds', entityId: editObjectif.id, entityNom: editObjectif.nom, details: { ancien: editObjectif.objectif, nouveau: newObj } });
      toast.success(`Objectif mis à jour ✓`);
      setEditObjectif(null);
    } catch {
      // Rollback
      setComptes(prev => prev.map(c => c.id === editObjectif.id ? { ...c, objectif: editObjectif.objectif } : c));
      toast.error('Erreur lors de la sauvegarde');
    }
    setSavingObj(false);
  };

  // ── Enregistrement mouvement ───────────────────────────────────────────────
  const enregistrer = async () => {
    if (!compteId || !dateOp) { toast.error('Fond et date sont obligatoires'); return; }
    if (!montantFond && !montantTotal && !(impacterBanque && montantBanque)) {
      toast.error('Saisissez au moins un montant'); return;
    }
    const mtF = parseInt(montantFond)   || 0;
    const mtB = parseInt(montantBanque) || 0;
    const mtT = parseInt(montantTotal)  || 0;
    setSaving(true);
    try {
      const fondNom = comptes.find(c => c.id === compteId)?.nom ?? '';
      const desc    = note || `${type === 'ajout' ? 'Ajout' : 'Retrait'} — ${fondNom}`;
      const res = await fetch('/api/decaissements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc, dateOperation: dateOp, notes: note || null,
          typeMouvement: type,
          montantTotal:  mtT  > 0 ? mtT  : null,
          montantFond:   mtF  > 0 ? mtF  : null,
          montantBanque: mtB  > 0 ? mtB  : null,
          compteId:      mtF  > 0 ? compteId : null,
          banqueId:      impacterBanque && banqueId && mtB > 0 ? banqueId : null,
          impacterBanque: impacterBanque && !!banqueId && mtB > 0,
        }),
      });
      if (res.ok) {
        // P11 : log
        await log(type === 'ajout' ? 'ajout_fond' : 'retrait_fond', {
          entityType: 'compte_fonds', entityId: compteId, entityNom: fondNom,
          details: { montantFond: mtF, montantTotal: mtT, date: dateOp },
        });
        toast.success(type === 'ajout' ? 'Ajout enregistré ✓' : 'Retrait enregistré ✓');
        setMontantFond(''); setMontantBanque(''); setMontantTotal('');
        setNote(''); setDateOp(today);
        await charger();
        if (showChart && chartFondId) {
          setChartLoading(true);
          try { const r = await fetch(`/api/comptes/evolution?id=${chartFondId}`); if (r.ok) setChartData(await r.json()); } catch {}
          setChartLoading(false);
        }
      } else {
        const err = await res.json();
        toast.error(err.error ?? 'Erreur');
      }
    } catch { toast.error('Erreur réseau'); }
    setSaving(false);
  };

  // ── P12 : Suppression avec confirmation ────────────────────────────────────
  const demanderSuppression = (id: string, desc: string) => {
    setDeleteId(id);
    setDeleteDesc(desc);
  };

  const confirmerSuppression = async () => {
    if (!deleteId) return;
    const desc = deleteDesc;
    try {
      const res = await fetch(`/api/decaissements?id=${deleteId}`, { method: 'DELETE' });
      if (res.ok) {
        // P11 : log
        await log('delete_decaissement', { entityId: deleteId, entityNom: desc });
        toast.success('Mouvement supprimé');
        setDeleteId(null);
        chargerHistorique(histPage);
      } else toast.error('Erreur lors de la suppression');
    } catch { toast.error('Erreur réseau'); }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fondSelectionne    = comptes.find(c => c.id === compteId);
  const banqueSelectionnee = banques.find(b => b.id === banqueId);
  const formatDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${MOIS_COURTS[dt.getMonth()+1]}/${dt.getFullYear()}`;
  };
  const totalFonds   = comptes.filter(c => c.isActive).reduce((s, c) => s + (c.soldeActuel ?? 0), 0);
  const totalAjouts  = historique.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + (d.montantTotal ?? 0), 0);
  const totalRetraits = historique.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + (d.montantTotal ?? 0), 0);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;

  return (
    <div className="space-y-5 animate-fadeIn max-w-3xl mx-auto">

      {/* P12 — Modal confirmation suppression */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmerSuppression}
        titre="Supprimer ce mouvement ?"
        message={`"${deleteDesc}" sera supprimé et le solde du fond sera annulé. Cette action est irréversible.`}
        type="danger"
        confirmMode="button"
        labelConfirm="Supprimer le mouvement"
      />

      {/* P7 — Modal objectif fond */}
      {editObjectif && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditObjectif(null)} />
          <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-t-2xl"/>
            <div>
              <h3 className="font-bold text-[var(--text)]">🎯 Objectif — {editObjectif.nom}</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Montant cible à atteindre pour ce fond</p>
            </div>
            <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 flex justify-between">
              <span className="text-xs text-[var(--text-muted)]">Actuel</span>
              <span className="text-sm font-bold text-[var(--text)]">{formatFCFA(editObjectif.objectif)}</span>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Nouvel objectif (FCFA)</label>
              <input type="number" value={objVal} onChange={e => setObjVal(e.target.value)} onKeyDown={onlyNumbers}
                placeholder={String(editObjectif.objectif || 0)} autoFocus
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditObjectif(null)} className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all">Annuler</button>
              <button onClick={sauvegarderObjectif} disabled={savingObj || !objVal}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold transition-all disabled:opacity-60">
                <Target size={14}/>{savingObj ? 'Sauvegarde...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Ajout / Retrait — Fonds</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez les mouvements sur vos fonds de fonctionnement</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={26} className="text-green-600 flex-shrink-0"/>
          <div><p className="text-xs text-green-700 dark:text-green-400 opacity-70">Total ajouté</p><p className="text-lg font-bold text-green-700 dark:text-green-400">{formatFCFA(totalAjouts)}</p></div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={26} className="text-red-500 flex-shrink-0"/>
          <div><p className="text-xs text-red-600 dark:text-red-400 opacity-70">Total retiré</p><p className="text-lg font-bold text-red-600 dark:text-red-400">{formatFCFA(totalRetraits)}</p></div>
        </div>
      </div>

      {/* ── Soldes fonds avec objectif P7 ── */}
      {comptes.filter(c => c.isActive).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {comptes.filter(c => c.isActive).map((c: any) => {
            const pct = c.objectif > 0 ? Math.min(100, Math.round((c.soldeActuel / c.objectif) * 100)) : null;
            return (
              <div key={c.id}
                onClick={() => setCompteId(c.id)}
                className={clsx('rounded-2xl border p-3.5 cursor-pointer transition-all relative group',
                  compteId === c.id ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-primary/40')}>
                {/* Graphique P6 */}
                <button onClick={e => { e.stopPropagation(); chargerEvolution(c.id); }}
                  title="Évolution 12 mois"
                  className={clsx('absolute top-2 right-2 p-1.5 rounded-lg transition-all',
                    chartFondId === c.id && showChart
                      ? 'bg-primary text-white'
                      : 'opacity-0 group-hover:opacity-100 bg-[var(--border)] text-[var(--text-muted)]')}>
                  <BarChart2 size={11}/>
                </button>
                <p className="text-xs font-medium text-[var(--text-muted)] truncate mb-1 pr-7">{c.nom}</p>
                <p className={clsx('text-base font-bold', compteId === c.id ? 'text-primary' : 'text-[var(--text)]')}>
                  {formatFCFA(c.soldeActuel ?? 0)}
                </p>
                {/* P7 : objectif + barre */}
                {c.objectif > 0 ? (
                  <div className="mt-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[var(--text-muted)]">Objectif</span>
                      <span className={clsx('text-[10px] font-bold',
                        pct! >= 100 ? 'text-green-600' : pct! >= 50 ? 'text-amber-500' : 'text-[var(--text-muted)]')}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full transition-all',
                        pct! >= 100 ? 'bg-green-500' : pct! >= 50 ? 'bg-amber-400' : 'bg-primary/60')}
                        style={{ width: `${Math.min(100, pct!)}%` }}/>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatFCFA(c.objectif)}</p>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setEditObjectif({id:c.id,nom:c.nom,objectif:0}); setObjVal(''); }}
                    className="mt-1 text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 flex items-center gap-0.5 hover:text-primary transition-all">
                    <Target size={9}/> Définir objectif
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* P6 — Graphique évolution */}
      {showChart && chartFondId && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors animate-fadeIn">
          <div className="px-5 py-3.5 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-primary"/>
              <h3 className="font-semibold text-[var(--text)] text-sm">Évolution — {chartData?.compte?.nom ?? '...'}</h3>
              <span className="text-xs text-[var(--text-muted)]">12 mois</span>
            </div>
            <button onClick={() => setShowChart(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-card transition-all">
              <X size={15}/>
            </button>
          </div>
          {chartLoading ? (
            <div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-primary"/></div>
          ) : chartData?.mois?.length > 0 ? (
            <div className="p-5">
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label:'Solde actuel', val:chartData.soldeActuel, cls:'text-primary' },
                  { label:'Total 12 mois', val:chartData.mois?.reduce((s:number,m:any)=>s+m.contribution,0)??0, cls:'text-green-600 dark:text-green-400' },
                  { label:'Moy. mensuelle', val:Math.round((chartData.mois?.reduce((s:number,m:any)=>s+m.contribution,0)??0)/Math.max(1,chartData.mois?.filter((m:any)=>m.contribution>0).length??1)), cls:'text-[var(--text)]' },
                ].map(k=>(
                  <div key={k.label} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 text-center">
                    <p className="text-xs text-[var(--text-muted)] mb-1">{k.label}</p>
                    <p className={clsx('text-sm font-bold',k.cls)}>{formatFCFA(k.val)}</p>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <ComposedChart data={chartData.mois} margin={{top:8,right:8,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                  <XAxis dataKey="label" tick={{fontSize:10,fill:'var(--text-muted)'}} tickLine={false} axisLine={false}/>
                  <YAxis yAxisId="left" tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={(v:number)=>v>=1000?`${Math.round(v/1000)}k`:String(v)} tickLine={false} axisLine={false} width={38}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={(v:number)=>v>=1000?`${Math.round(v/1000)}k`:String(v)} tickLine={false} axisLine={false} width={38}/>
                  <Tooltip formatter={(v:number,n:string)=>[formatFCFA(v),n==='contribution'?'Réel':n==='contributionAnticipee'?'Prévision':'Cumul']}
                    contentStyle={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'10px',fontSize:'12px'}}/>
                  <Legend iconType="circle" iconSize={8} formatter={(v:string)=>v==='contribution'?'Réel':v==='contributionAnticipee'?'Prévision':'Solde cumulatif'} wrapperStyle={{fontSize:'11px'}}/>
                  <Bar yAxisId="left" dataKey="contributionAnticipee" fill="#E2E8F0" radius={[3,3,0,0]} maxBarSize={20}/>
                  <Bar yAxisId="left" dataKey="contribution" fill="#3B82F6" radius={[3,3,0,0]} maxBarSize={20}/>
                  <Line yAxisId="right" type="monotone" dataKey="soldeCumulatif" stroke="#10B981" strokeWidth={2} dot={{fill:'#10B981',r:3,strokeWidth:0}} activeDot={{r:5}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-8 text-center text-[var(--text-muted)] text-sm">Aucune donnée disponible — configurez la liaison dans Paramètres → Catégories</div>
          )}
        </div>
      )}

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)]">
        {([['form','➕ Nouveau mouvement'],['historique','📋 Historique']] as const).map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab===tab?'bg-[var(--surface)] text-primary shadow-sm':'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
            {tab==='historique'&&histTotal>0&&(
              <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">{histTotal}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Onglet Formulaire ── */}
      {activeTab === 'form' && (<>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 space-y-5 transition-colors">
          <h2 className="font-semibold text-[var(--text)]">Nouveau mouvement</h2>

          {/* Type */}
          <div className="flex gap-2">
            <button onClick={()=>setType('ajout')} className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all', type==='ajout'?'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400':'border-[var(--border)] text-[var(--text-muted)] hover:border-green-300')}>
              <ArrowUpCircle size={18}/>Ajout
            </button>
            <button onClick={()=>setType('retrait')} className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all', type==='retrait'?'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400':'border-[var(--border)] text-[var(--text-muted)] hover:border-red-300')}>
              <ArrowDownCircle size={18}/>Retrait
            </button>
          </div>

          {/* Fond + montant */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Fond *</label>
              <select value={compteId} onChange={e=>setCompteId(e.target.value)} className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                <option value="">— Choisir —</option>
                {comptes.filter(c=>c.isActive).map((c:any)=>(
                  <option key={c.id} value={c.id}>{c.nom} ({formatFCFA(c.soldeActuel??0)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant fond (FCFA)</label>
              <input type="number" value={montantFond} onChange={e=>setMontantFond(e.target.value)} onKeyDown={onlyNumbers} placeholder="0" min="0" className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
            </div>
          </div>

          {/* Montant total (optionnel) */}
          <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Info size={14} className="text-primary flex-shrink-0"/>
              <label className="text-xs font-medium text-[var(--text)]">{type==='ajout'?'Montant total reçu — impacte "Autres revenus" dans Suivi':'Montant total dépensé — impacte "Autre dépense 1" dans Suivi'}</label>
            </div>
            <input type="number" value={montantTotal} onChange={e=>setMontantTotal(e.target.value)} onKeyDown={onlyNumbers} placeholder="Optionnel" min="0" className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
          </div>

          {/* Date + Note */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Date *</label>
              <input type="date" value={dateOp} onChange={e=>setDateOp(e.target.value)} className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Note</label>
              <input type="text" value={note} onChange={e=>setNote(e.target.value)} placeholder="Ex: Cotisation septembre" className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
            </div>
          </div>

          {/* Impact bancaire */}
          <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="impacter-banque" checked={impacterBanque} onChange={e=>setImpacterBanque(e.target.checked)} className="w-4 h-4 accent-primary cursor-pointer"/>
              <label htmlFor="impacter-banque" className="text-sm font-medium text-[var(--text)] cursor-pointer flex items-center gap-2">
                <Building2 size={15} className="text-primary"/>Impacter un compte bancaire
              </label>
            </div>
            {impacterBanque && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Banque</label>
                  <select value={banqueId} onChange={e=>setBanqueId(e.target.value)} className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                    <option value="">— Choisir —</option>
                    {banques.map((b:any)=>(<option key={b.id} value={b.id}>{b.nomBanque} ({formatFCFA(b.solde??0)})</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant banque (FCFA)</label>
                  <input type="number" value={montantBanque} onChange={e=>setMontantBanque(e.target.value)} onKeyDown={onlyNumbers} placeholder="0" min="0" className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
                </div>
              </div>
            )}
            {impacterBanque && banqueId && (montantFond||montantBanque) && (
              <div className={clsx('rounded-lg p-2.5 text-xs font-medium',type==='ajout'?'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400':'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400')}>
                {type==='ajout'?(
                  <span>{banqueSelectionnee?.nomBanque} <strong>−{formatFCFA(parseInt(montantBanque)||0)}</strong>{' → '}{fondSelectionne?.nom} <strong>+{formatFCFA(parseInt(montantFond)||0)}</strong></span>
                ):(
                  <span>{fondSelectionne?.nom} <strong>−{formatFCFA(parseInt(montantFond)||0)}</strong>{' → '}{banqueSelectionnee?.nomBanque} <strong>+{formatFCFA(parseInt(montantBanque)||0)}</strong></span>
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <button onClick={enregistrer} disabled={saving||!compteId||!dateOp}
            className={clsx('w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60',
              type==='ajout'?'bg-green-600 hover:bg-green-700 text-white':'bg-red-500 hover:bg-red-600 text-white')}>
            <Save size={16}/>
            {saving?'Enregistrement...':type==='ajout'?"Enregistrer l'ajout":"Enregistrer le retrait"}
          </button>
        </div>
      </>)}

      {/* ── Onglet Historique avec pagination P14 ── */}
      {activeTab === 'historique' && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card flex items-center justify-between">
            <h3 className="font-semibold text-[var(--text)]">Historique des mouvements</h3>
            <span className="text-xs text-[var(--text-muted)]">
              {historique.length}/{histTotal} opération(s)
            </span>
          </div>
          {historique.length === 0 && !loadingHist ? (
            <div className="px-5 py-8 text-center text-[var(--text-muted)] text-sm">Aucun mouvement enregistré</div>
          ) : (
            <>
              <div className="divide-y divide-[var(--border)]">
                {historique.map((d: any) => {
                  const fondNom = d.repartitions?.[0]?.compte?.nom ?? '—';
                  const isAjout = d.typeMouvement === 'ajout';
                  return (
                    <div key={d.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                      <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                        isAjout?'bg-green-100 dark:bg-green-900/30':'bg-red-100 dark:bg-red-900/30')}>
                        {isAjout?<ArrowUpCircle size={18} className="text-green-600"/>:<ArrowDownCircle size={18} className="text-red-500"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{d.description}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{fondNom} · {formatDate(d.dateOperation)}</p>
                      </div>
                      <p className={clsx('text-sm font-bold flex-shrink-0',isAjout?'text-green-600':'text-red-500')}>
                        {isAjout?'+':'−'}{formatFCFA(d.montantTotal)}
                      </p>
                      {/* P12 : bouton suppression → demande confirmation */}
                      <button onClick={()=>demanderSuppression(d.id, d.description)}
                        className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0 p-1">
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* P14 : Bouton "Charger plus" */}
              {historique.length < histTotal && (
                <div className="px-5 py-4 border-t border-[var(--border)] text-center">
                  <button
                    onClick={() => chargerHistorique(histPage + 1, true)}
                    disabled={loadingHist}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all disabled:opacity-60">
                    {loadingHist
                      ? <><Loader2 size={14} className="animate-spin"/> Chargement...</>
                      : <>Charger plus <span className="text-xs opacity-60">({histTotal - historique.length} restants)</span></>
                    }
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
