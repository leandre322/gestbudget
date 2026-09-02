'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Save, ArrowUpCircle, ArrowDownCircle, Trash2, Building2,
  BarChart2, Loader2, X, RefreshCcw, AlertCircle, CheckCircle2,
  Lock,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ConfirmModal, useAudit } from '@/components/ConfirmModal';
import { formatFCFA } from '@/types';
import { useLock } from '../contexts';
import { clsx } from 'clsx';

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const PAGE_SIZE   = 20;

const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const ok = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (ok.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/\d/.test(e.key)) e.preventDefault();
};

type Mode    = 'fond' | 'transfert' | 'banque';
type TypeMvt = 'ajout' | 'retrait' | 'set';
type Source  = 'fond' | 'transfert' | 'banque';

interface HistItem {
  id:               string;
  source:           Source;
  description:      string;
  typeMouvement:    TypeMvt;
  montant:          number;
  fondNom?:         string;
  banqueNom?:       string;
  soldeAvantFond?:  number;
  soldeApresFond?:  number;
  soldeAvantBanque?:number;
  soldeApresBanque?:number;
  dateOperation:    string;
}

const BADGE: Record<Source, { label:string; emoji:string; bg:string; text:string }> = {
  fond:      { label:'Fond',      emoji:'📂', bg:'bg-blue-100 dark:bg-blue-900/30',    text:'text-blue-700 dark:text-blue-400'    },
  transfert: { label:'Transfert', emoji:'🔄', bg:'bg-purple-100 dark:bg-purple-900/30',text:'text-purple-700 dark:text-purple-400' },
  banque:    { label:'Banque',    emoji:'🏦', bg:'bg-green-100 dark:bg-green-900/30',  text:'text-green-700 dark:text-green-400'   },
};

export default function AjoutRetraitFondsPage() {
  const toast   = useToast();
  const { log } = useAudit();
  const { isLocked, openUnlockModal } = useLock();

  const [comptes,      setComptes]      = useState<any[]>([]);
  const [banques,      setBanques]      = useState<any[]>([]);
  const [historique,   setHistorique]   = useState<HistItem[]>([]);
  const [histLoading,  setHistLoading]  = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const [mode, setMode] = useState<Mode>('fond');
  const [type, setType] = useState<TypeMvt>('ajout');

  const today = new Date().toISOString().split('T')[0];
  const [compteId,      setCompteId]      = useState('');
  const [banqueId,      setBanqueId]      = useState('');
  const [montantFond,   setMontantFond]   = useState('');
  const [montantBanque, setMontantBanque] = useState('');
  const [note,          setNote]          = useState('');
  const [dateOp,        setDateOp]        = useState(today);

  const [deleteTarget, setDeleteTarget] = useState<{id:string;desc:string;source:Source}|null>(null);
  const [activeTab,    setActiveTab]    = useState<'form'|'historique'>('form');

  const changeMode = (m: Mode) => {
    setMode(m);
    setMontantFond(''); setMontantBanque(''); setNote('');
    if (m === 'banque') { setCompteId(''); setType('ajout'); }
    if (m === 'fond')   { setBanqueId(''); }
  };

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [rC, rB] = await Promise.all([fetch('/api/comptes'), fetch('/api/banques')]);
      if (rC.ok) {
        const d = await rC.json();
        setComptes(d.comptes ?? []);
        if (!compteId && d.comptes?.length) setCompteId(d.comptes[0].id);
      }
      if (rB.ok) { const d = await rB.json(); setBanques(d.banques ?? []); }
    } catch {}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chargerHistorique = useCallback(async () => {
    setHistLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/decaissements?limit=100'),
        fetch('/api/banques/mouvements?limit=100'),
      ]);
      const d1 = r1.ok ? await r1.json() : { decaissements: [] };
      const d2 = r2.ok ? await r2.json() : { mouvements: [] };

      const fondItems: HistItem[] = (d1.decaissements ?? []).map((d: any) => ({
        id:               d.id,
        source:           (d.banqueId ? 'transfert' : 'fond') as Source,
        description:      d.description,
        typeMouvement:    d.typeMouvement,
        montant:          d.montantFond || d.montantTotal || 0,
        fondNom:          d.repartitions?.[0]?.compte?.nom,
        soldeAvantFond:   d.soldeAvantFond,
        soldeApresFond:   d.soldeApresFond,
        soldeAvantBanque: d.soldeAvantBanque,
        soldeApresBanque: d.soldeApresBanque,
        dateOperation:    d.dateOperation,
      }));

      const banqueItems: HistItem[] = (d2.mouvements ?? []).map((m: any) => ({
        id:               m.id,
        source:           'banque' as Source,
        description:      m.motif || `${m.typeMouvement==='set'?'Correction':m.typeMouvement==='ajout'?'Ajout':'Retrait'} — ${m.banque?.nomBanque??''}`,
        typeMouvement:    m.typeMouvement,
        montant:          m.montant || 0,
        banqueNom:        m.banque?.nomBanque,
        soldeAvantBanque: m.soldeAvant,
        soldeApresBanque: m.soldeApres,
        dateOperation:    m.dateOperation,
      }));

      const merged = [...fondItems, ...banqueItems].sort(
        (a, b) => new Date(b.dateOperation).getTime() - new Date(a.dateOperation).getTime()
      );
      setHistorique(merged);
      setDisplayCount(PAGE_SIZE);
    } catch {}
    setHistLoading(false);
  }, []);

  useEffect(() => { charger(); chargerHistorique(); }, [charger, chargerHistorique]);
  useEffect(() => { if (activeTab==='historique') chargerHistorique(); }, [activeTab, chargerHistorique]);

  // ── Enregistrer fond / transfert ──────────────────────────────────────────
  const enregistrerFond = async () => {
    if (isLocked) { openUnlockModal(); return; }
    if (!dateOp)     { toast.error('Date obligatoire'); return; }
    if (!compteId)   { toast.error('Sélectionnez un fond'); return; }
    if (!montantFond || parseInt(montantFond)<=0) { toast.error('Montant fond obligatoire'); return; }
    if (mode==='transfert' && !banqueId) { toast.error('Sélectionnez une banque'); return; }

    const mtF = parseInt(montantFond)||0;
    const mtB = parseInt(montantBanque)||0;
    const fondNom = comptes.find(c=>c.id===compteId)?.nom??'';
    const desc    = note || `${type==='ajout'?'Ajout':'Retrait'} — ${fondNom}`;

    setSaving(true);
    try {
      const res = await fetch('/api/decaissements', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ description:desc, dateOperation:dateOp, notes:note||null,
          typeMouvement:type, compteId, banqueId:mode==='transfert'&&mtB>0?banqueId:null,
          montantFond:mtF, montantBanque:mode==='transfert'?mtB:0,
          impacterBanque:mode==='transfert'&&!!banqueId&&mtB>0 }),
      });
      if (res.ok) {
        toast.success(type==='ajout'?'Ajout enregistré ✓':'Retrait enregistré ✓');
        setMontantFond(''); setMontantBanque(''); setNote(''); setDateOp(today);
        await charger(); chargerHistorique();
      } else { const err=await res.json(); toast.error(err.error??'Erreur'); }
    } catch { toast.error('Erreur réseau'); }
    setSaving(false);
  };

  // ── Enregistrer banque seule ──────────────────────────────────────────────
  const enregistrerBanque = async () => {
    if (isLocked) { openUnlockModal(); return; }
    if (!banqueId) { toast.error('Sélectionnez un compte bancaire'); return; }
    if (!dateOp)   { toast.error('Date obligatoire'); return; }
    if (type!=='set' && (!montantBanque || parseInt(montantBanque)<=0)) { toast.error('Montant obligatoire'); return; }
    if (type==='set' && !note.trim()) { toast.error('Le motif est obligatoire pour une correction'); return; }

    const mt = parseInt(montantBanque)||0;
    setSaving(true);
    try {
      const res = await fetch('/api/banques/mouvements', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ banqueId, typeMouvement:type, montant:mt, motif:note||null, dateOperation:dateOp }),
      });
      if (res.ok) {
        toast.success(type==='set'?'🔧 Solde corrigé ✓':type==='ajout'?'✅ Ajout enregistré ✓':'⬇ Retrait enregistré ✓');
        setMontantBanque(''); setNote(''); setDateOp(today);
        await charger(); chargerHistorique();
      } else { const err=await res.json(); toast.error(err.error??'Erreur'); }
    } catch { toast.error('Erreur réseau'); }
    setSaving(false);
  };

  // ── Suppression ───────────────────────────────────────────────────────────
  const confirmerSuppression = async () => {
    if (!deleteTarget) return;
    try {
      const url = deleteTarget.source==='banque'
        ? `/api/banques/mouvements?id=${deleteTarget.id}`
        : `/api/decaissements?id=${deleteTarget.id}`;
      const res = await fetch(url, { method:'DELETE' });
      if (res.ok) {
        toast.success('Mouvement supprimé — soldes restaurés ✓');
        setDeleteTarget(null);
        await charger(); chargerHistorique();
      } else toast.error('Erreur lors de la suppression');
    } catch { toast.error('Erreur réseau'); }
  };

  // ── Aperçu temps réel ─────────────────────────────────────────────────────
  const fondSel   = comptes.find(c=>c.id===compteId);
  const banqueSel = banques.find(b=>b.id===banqueId);
  const mtF = parseInt(montantFond)||0;
  const mtB = parseInt(montantBanque)||0;

  const preview = (() => {
    if (mode==='fond' && fondSel && mtF>0) {
      const apres = type==='ajout' ? fondSel.soldeActuel+mtF : fondSel.soldeActuel-mtF;
      return { fondAvant:fondSel.soldeActuel, fondApres:apres, ok:apres>=0 };
    }
    if (mode==='transfert' && fondSel && mtF>0) {
      const fondApres   = type==='ajout' ? fondSel.soldeActuel+mtF : fondSel.soldeActuel-mtF;
      const banqueApres = banqueSel&&mtB>0 ? (type==='ajout'?banqueSel.solde-mtB:banqueSel.solde+mtB) : undefined;
      return { fondAvant:fondSel.soldeActuel, fondApres, banqueAvant:banqueSel?.solde, banqueApres, ok:fondApres>=0 };
    }
    if (mode==='banque' && banqueSel) {
      if (type==='set'&&mtB>=0) return { banqueAvant:banqueSel.solde, banqueApres:mtB, diff:mtB-banqueSel.solde, ok:true, isSet:true };
      if (mtB>0) { const apres=type==='ajout'?banqueSel.solde+mtB:banqueSel.solde-mtB; return { banqueAvant:banqueSel.solde, banqueApres:apres, ok:apres>=0 }; }
    }
    return null;
  })();

  // ── 4 KPIs depuis historique ──────────────────────────────────────────────
  const kpiFondAjouts    = historique.filter(h=>h.source!=='banque'&&h.typeMouvement==='ajout').reduce((s,h)=>s+h.montant,0);
  const kpiFondRetraits  = historique.filter(h=>h.source!=='banque'&&h.typeMouvement==='retrait').reduce((s,h)=>s+h.montant,0);
  const kpiBanqueAjouts  = historique.filter(h=>h.source==='banque'&&h.typeMouvement==='ajout').reduce((s,h)=>s+h.montant,0);
  const kpiBanqueRetraits= historique.filter(h=>h.source==='banque'&&h.typeMouvement==='retrait').reduce((s,h)=>s+h.montant,0);

  const formatDate = (d:string|Date) => {
    const dt=new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${MOIS_COURTS[dt.getMonth()+1]}/${dt.getFullYear()}`;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;

  return (
    <div className="space-y-5 animate-fadeIn max-w-3xl mx-auto">

      <ConfirmModal isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)}
        onConfirm={confirmerSuppression} titre="Supprimer ce mouvement ?"
        message={`"${deleteTarget?.desc}" sera supprimé et les soldes restitués. Irréversible.`}
        type="danger" confirmMode="button" labelConfirm="Supprimer et restituer"/>

      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Ajout / Retrait — Fonds & Banques</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez les mouvements sur vos fonds et comptes bancaires</p>
      </div>

      {/* ── 4 KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { emoji:'📂', label:'Fonds ajoutés',    val:kpiFondAjouts,    bg:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',    text:'text-green-700 dark:text-green-400'    },
          { emoji:'📂', label:'Fonds retirés',    val:kpiFondRetraits,  bg:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',            text:'text-red-600 dark:text-red-400'        },
          { emoji:'🏦', label:'Banques ajoutées', val:kpiBanqueAjouts,  bg:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',        text:'text-blue-700 dark:text-blue-400'      },
          { emoji:'🏦', label:'Banques retirées', val:kpiBanqueRetraits,bg:'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',text:'text-orange-600 dark:text-orange-400'   },
        ].map(k=>(
          <div key={k.label} className={clsx('rounded-2xl border p-4 flex items-center gap-3',k.bg)}>
            <span className="text-xl flex-shrink-0">{k.emoji}</span>
            <div>
              <p className={clsx('text-xs opacity-70',k.text)}>{k.label}</p>
              <p className={clsx('text-base font-bold',k.text)}>{formatFCFA(k.val)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Onglets ── */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)]">
        {([['form','➕ Nouveau mouvement'],['historique','📋 Historique']] as const).map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab===tab?'bg-[var(--surface)] text-primary shadow-sm':'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
            {tab==='historique'&&historique.length>0&&(
              <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">{historique.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ONGLET FORMULAIRE                                                  */}
      {activeTab==='form' && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 space-y-5">

          {/* Bannière lock si verrouillé */}
          {isLocked && (
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-dark-card border border-[var(--border)] rounded-xl px-4 py-3">
              <Lock size={14} className="text-slate-400 flex-shrink-0"/>
              <p className="text-sm text-[var(--text-muted)]">Page verrouillée — cliquez "Modifier" dans la bannière pour enregistrer des mouvements.</p>
            </div>
          )}

          {/* 1. Sélecteur de mode */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] mb-2 block uppercase tracking-wider">Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {([['fond','📂','Fond seul','Modifier un fond de fonctionnement'],['transfert','🔄','Fond + Banque','Transférer entre fond et banque'],['banque','🏦','Banque seule','Modifier un compte bancaire']] as const).map(([m,emoji,label,desc])=>(
                <button key={m} onClick={()=>!isLocked&&changeMode(m)}
                  className={clsx('flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all',
                    isLocked?'opacity-50 cursor-not-allowed border-[var(--border)]':mode===m?'border-primary bg-primary/5 shadow-sm':'border-[var(--border)] hover:border-primary/40')}>
                  <span className="text-xl">{emoji}</span>
                  <span className={clsx('text-xs font-semibold',mode===m?'text-primary':'text-[var(--text)]')}>{label}</span>
                  <span className="text-[10px] text-[var(--text-muted)] leading-tight hidden sm:block">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Type d'opération */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] mb-2 block uppercase tracking-wider">Type d'opération</label>
            <div className="flex gap-2">
              <button onClick={()=>!isLocked&&setType('ajout')} disabled={isLocked}
                className={clsx('flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all disabled:opacity-50',
                  type==='ajout'?'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700':'border-[var(--border)] text-[var(--text-muted)]')}>
                <ArrowUpCircle size={16}/>Ajout
              </button>
              <button onClick={()=>!isLocked&&setType('retrait')} disabled={isLocked}
                className={clsx('flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all disabled:opacity-50',
                  type==='retrait'?'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600':'border-[var(--border)] text-[var(--text-muted)]')}>
                <ArrowDownCircle size={16}/>Retrait
              </button>
              {mode==='banque'&&(
                <button onClick={()=>!isLocked&&setType('set')} disabled={isLocked}
                  className={clsx('flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all disabled:opacity-50',
                    type==='set'?'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700':'border-[var(--border)] text-[var(--text-muted)]')}>
                  <RefreshCcw size={16}/>Correction
                </button>
              )}
            </div>
          </div>

          {/* Champs dynamiques */}
          {(mode==='fond'||mode==='transfert')&&(
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Fond *</label>
                <select value={compteId} onChange={e=>setCompteId(e.target.value)} disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50">
                  <option value="">— Choisir —</option>
                  {comptes.filter(c=>c.isActive).map((c:any)=><option key={c.id} value={c.id}>{c.nom} ({formatFCFA(c.soldeActuel??0)})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant fond (FCFA) *</label>
                <input type="number" value={montantFond} onChange={e=>setMontantFond(e.target.value)} onKeyDown={onlyNumbers}
                  placeholder="0" min="0" disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50"/>
              </div>
            </div>
          )}

          {mode==='transfert'&&(
            <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-4 space-y-3 border border-[var(--border)]">
              <div className="flex items-center gap-2"><Building2 size={14} className="text-primary"/><span className="text-xs font-semibold text-[var(--text)]">Banque associée</span></div>
              <div className="grid grid-cols-2 gap-3">
                <select value={banqueId} onChange={e=>setBanqueId(e.target.value)} disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50">
                  <option value="">— Choisir —</option>
                  {banques.map((b:any)=><option key={b.id} value={b.id}>{b.nomBanque} ({formatFCFA(b.solde??0)})</option>)}
                </select>
                <input type="number" value={montantBanque} onChange={e=>setMontantBanque(e.target.value)} onKeyDown={onlyNumbers}
                  placeholder="0" min="0" disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50"/>
              </div>
            </div>
          )}

          {mode==='banque'&&(
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Compte bancaire *</label>
                <select value={banqueId} onChange={e=>setBanqueId(e.target.value)} disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50">
                  <option value="">— Choisir —</option>
                  {banques.map((b:any)=><option key={b.id} value={b.id}>{b.nomBanque} ({formatFCFA(b.solde??0)})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">{type==='set'?'Nouveau solde exact (FCFA) *':'Montant (FCFA) *'}</label>
                <input type="number" value={montantBanque} onChange={e=>setMontantBanque(e.target.value)} onKeyDown={onlyNumbers}
                  placeholder={type==='set'?String(banqueSel?.solde??0):'0'} min="0" disabled={isLocked}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50"/>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Date *</label>
              <input type="date" value={dateOp} onChange={e=>setDateOp(e.target.value)} disabled={isLocked}
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50"/>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">{type==='set'?'Motif (obligatoire) *':'Note'}</label>
              <input type="text" value={note} onChange={e=>setNote(e.target.value)} disabled={isLocked}
                placeholder={type==='set'?'Ex: Mise à jour solde réel':'Ex: Cotisation septembre'}
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-50"/>
            </div>
          </div>

          {/* Aperçu temps réel */}
          {preview && !isLocked && (
            <div className={clsx('rounded-xl border p-4 space-y-2.5 transition-all',
              !preview.ok?'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800':'bg-slate-50 dark:bg-dark-card border-[var(--border)]')}>
              <div className="flex items-center gap-2">
                {preview.ok?<CheckCircle2 size={14} className="text-green-600"/>:<AlertCircle size={14} className="text-red-500"/>}
                <span className="text-xs font-semibold text-[var(--text)]">Aperçu de l'opération</span>
                <span className="text-[10px] text-green-600 dark:text-green-400 ml-auto font-medium">📅 Suivi mensuel non affecté ✅</span>
              </div>
              {preview.fondAvant!==undefined&&(
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] text-[var(--text-muted)] w-28 flex-shrink-0 truncate">📂 {fondSel?.nom}</span>
                  <span>{formatFCFA(preview.fondAvant)}</span>
                  <span className="text-xs text-[var(--text-muted)]">→</span>
                  <span className={clsx('font-bold',(preview.fondApres??0)>=0?'text-primary':'text-red-500')}>{formatFCFA(preview.fondApres??0)}</span>
                </div>
              )}
              {preview.banqueAvant!==undefined&&(
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] text-[var(--text-muted)] w-28 flex-shrink-0 truncate">🏦 {banqueSel?.nomBanque}</span>
                  <span>{formatFCFA(preview.banqueAvant)}</span>
                  <span className="text-xs text-[var(--text-muted)]">→</span>
                  <span className={clsx('font-bold',(preview.banqueApres??0)>=0?'text-blue-600':'text-red-500')}>{formatFCFA(preview.banqueApres??0)}</span>
                </div>
              )}
              {!preview.ok&&<p className="text-xs text-red-600 font-semibold">⚠️ Solde insuffisant — opération bloquée</p>}
            </div>
          )}

          {/* Bouton submit */}
          <button onClick={mode==='banque'?enregistrerBanque:enregistrerFond}
            disabled={saving||isLocked||!dateOp
              ||(mode!=='banque'&&(!compteId||!montantFond))
              ||(mode==='banque'&&(!banqueId||(type!=='set'&&!montantBanque)))}
            className={clsx('w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60',
              type==='ajout'?'bg-green-600 hover:bg-green-700 text-white':
              type==='set'  ?'bg-amber-500 hover:bg-amber-600 text-white':
                             'bg-red-500 hover:bg-red-600 text-white')}>
            <Save size={16}/>
            {saving?'Enregistrement...':type==='set'?'🔧 Corriger le solde':type==='ajout'?'✅ Enregistrer l\'ajout':'⬇ Enregistrer le retrait'}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ONGLET HISTORIQUE                                                  */}
      {activeTab==='historique'&&(
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-[var(--text)]">Historique des mouvements</h3>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(BADGE).map(([src,cfg])=>(
                <span key={src} className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full',cfg.bg,cfg.text)}>{cfg.emoji} {cfg.label}</span>
              ))}
              <span className="text-xs text-[var(--text-muted)]">{historique.length} op.</span>
            </div>
          </div>
          {histLoading?(
            <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-primary"/></div>
          ):historique.length===0?(
            <div className="px-5 py-8 text-center text-[var(--text-muted)] text-sm">Aucun mouvement enregistré</div>
          ):(
            <>
              <div className="divide-y divide-[var(--border)]">
                {historique.slice(0,displayCount).map(item=>{
                  const badge=BADGE[item.source];
                  const isAjout=item.typeMouvement==='ajout', isSet=item.typeMouvement==='set';
                  return(
                    <div key={`${item.source}-${item.id}`} className="px-5 py-3.5 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5',
                          isSet?'bg-amber-100 dark:bg-amber-900/30':isAjout?'bg-green-100 dark:bg-green-900/30':'bg-red-100 dark:bg-red-900/30')}>
                          {isSet?<RefreshCcw size={15} className="text-amber-600"/>:
                           isAjout?<ArrowUpCircle size={15} className="text-green-600"/>:
                           <ArrowDownCircle size={15} className="text-red-500"/>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',badge.bg,badge.text)}>{badge.emoji} {badge.label}</span>
                            <p className="text-sm font-medium text-[var(--text)] truncate">{item.description}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
                            {item.fondNom&&<span>📂 {item.fondNom}</span>}
                            {item.banqueNom&&<span>🏦 {item.banqueNom}</span>}
                            <span>{formatDate(item.dateOperation)}</span>
                          </div>
                          {item.soldeAvantFond!==undefined&&item.soldeApresFond!==undefined&&(
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Fond : {formatFCFA(item.soldeAvantFond)} → <strong>{formatFCFA(item.soldeApresFond)}</strong></p>
                          )}
                          {item.source==='banque'&&item.soldeAvantBanque!==undefined&&item.soldeApresBanque!==undefined&&(
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Banque : {formatFCFA(item.soldeAvantBanque)} → <strong>{formatFCFA(item.soldeApresBanque)}</strong></p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className={clsx('text-sm font-bold',isSet?'text-amber-600':isAjout?'text-green-600':'text-red-500')}>
                            {isSet?'✎':isAjout?'+':'−'}{formatFCFA(item.montant)}
                          </p>
                          <button onClick={()=>setDeleteTarget({id:item.id,desc:item.description,source:item.source})}
                            className="text-slate-300 hover:text-red-500 transition-colors p-1">
                            <Trash2 size={13}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {historique.length>displayCount&&(
                <div className="px-5 py-4 border-t border-[var(--border)] text-center">
                  <button onClick={()=>setDisplayCount(c=>c+PAGE_SIZE)}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all">
                    Charger plus <span className="text-xs opacity-60">({historique.length-displayCount} restants)</span>
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
