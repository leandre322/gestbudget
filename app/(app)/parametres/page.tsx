'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Check, X, Upload, Save, Link, Link2Off,
         ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock } from 'lucide-react';
import { TYPE_LABELS, ORDRE_TYPES, formatFCFA } from '@/types';
import { clsx } from 'clsx';
import { useLock } from '../layout';

const GRANDES_CATEGORIES = [
  'epargne_precaution','epargne_investissement','epargne_autre',
  'depense_fixe','depense_variable','depense_occasionnelle','remboursement_dette',
] as const;
type GrandeCategorie = typeof GRANDES_CATEGORIES[number];

export default function ParametresPage() {
  const { isLocked, openUnlockModal } = useLock();

  const [categories,       setCategories]       = useState<any[]>([]);
  const [comptes,          setComptes]          = useState<any[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [editCat,          setEditCat]          = useState<any>(null);
  const [editCompte,       setEditCompte]       = useState<any>(null);
  const [newCat,           setNewCat]           = useState({ nom:'', type:'depense_variable', sousType:'' });
  const [showNewCat,       setShowNewCat]       = useState(false);
  const [newCompte,        setNewCompte]        = useState('');
  const [showNewCompte,    setShowNewCompte]    = useState(false);
  const [importing,        setImporting]        = useState(false);
  const [importResult,     setImportResult]     = useState<any>(null);
  const [banques,          setBanques]          = useState<any[]>([]);
  const [newBanque,        setNewBanque]        = useState({ nom:'', solde:'' });
  const [showNewBanque,    setShowNewBanque]    = useState(false);
  const [editBanque,       setEditBanque]       = useState<any>(null);
  const [anneesData,       setAnneesData]       = useState<any[]>([]);
  const [suppAnnee,        setSuppAnnee]        = useState<number|null>(null);
  const [suppMois,         setSuppMois]         = useState<number|null>(null);
  const [confirmText,      setConfirmText]      = useState('');
  const [suppLoading,      setSuppLoading]      = useState(false);
  const [suppResult,       setSuppResult]       = useState<string>('');
  const [activeTab,        setActiveTab]        = useState<'categories'|'comptes'|'banques'|'import'|'donnees'>('categories');
  const [tauxRef,          setTauxRef]          = useState<Record<GrandeCategorie, number>>({} as Record<GrandeCategorie, number>);
  const [revenuRef,        setRevenuRef]        = useState<number>(0);
  const [savingTaux,       setSavingTaux]       = useState(false);
  const [savedTaux,        setSavedTaux]        = useState(false);
  const [savingLien,       setSavingLien]       = useState<string|null>(null);
  const [savingBanqueLien, setSavingBanqueLien] = useState<string|null>(null);
  const [catGroupsOpen,    setCatGroupsOpen]    = useState<Record<string,boolean>>({});

  const toggleCatGroup = (type: string) => setCatGroupsOpen(p => ({ ...p, [type]: !p[type] }));
  const ouvrirTousCats = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t]=true; }); setCatGroupsOpen(n); };
  const plierTousCats  = () => setCatGroupsOpen({});
  const isDirty        = useRef(false);

  const charger = useCallback(async (force=false) => {
    setLoading(true);
    try {
      const [rCats,rComptes,rParams,rBanques,rDonnees] = await Promise.all([
        fetch('/api/categories'),fetch('/api/comptes'),fetch('/api/parametres'),
        fetch('/api/banques'),fetch('/api/donnees'),
      ]);
      if (rDonnees.ok){ const d=await rDonnees.json(); setAnneesData(d.annees??[]); }
      if (rBanques.ok){ const d=await rBanques.json(); setBanques(d.banques??[]); }
      if (rCats.ok)   { const d=await rCats.json();    setCategories(d.categories??[]); }
      if (rComptes.ok){ const d=await rComptes.json(); setComptes(d.comptes??[]); }
      if (rParams.ok) {
        const d=await rParams.json();
        if (!isDirty.current||force) {
          setRevenuRef(d.revenuMensuelReference??0);
          const taux={} as Record<GrandeCategorie,number>;
          GRANDES_CATEGORIES.forEach(type => {
            const cats=(d.categories??[]).filter((c:any)=>c.type===type);
            taux[type]=cats.reduce((max:number,c:any)=>Math.max(max,c.tauxReference??0),0);
          });
          setTauxRef(taux); isDirty.current=false;
        }
      }
    } catch(e){ console.error('charger error:',e); }
    finally{ setLoading(false); }
  },[]);

  useEffect(() => { charger(); },[charger]);

  const chargerOnglet = useCallback(async (tab:string) => {
    try {
      if (tab==='categories') {
        const [rC,rCo]=await Promise.all([fetch('/api/categories'),fetch('/api/comptes')]);
        if (rC.ok) { const d=await rC.json(); setCategories(d.categories??[]); }
        if (rCo.ok){ const d=await rCo.json(); setComptes(d.comptes??[]); }
      } else if (tab==='comptes') {
        const r=await fetch('/api/comptes'); if(r.ok){const d=await r.json();setComptes(d.comptes??[]);}
      } else if (tab==='banques') {
        const r=await fetch('/api/banques'); if(r.ok){const d=await r.json();setBanques(d.banques??[]);}
      } else if (tab==='donnees') {
        const r=await fetch('/api/donnees'); if(r.ok){const d=await r.json();setAnneesData(d.annees??[]);}
      }
    } catch(e){ console.error('chargerOnglet error:',e); }
  },[]);

  useEffect(() => { chargerOnglet(activeTab); },[activeTab,chargerOnglet]);

  const montantPourTaux=(taux:number)=>revenuRef>0?Math.round((taux/100)*revenuRef):0;
  const totalTaux=GRANDES_CATEGORIES.reduce((s,t)=>s+(tauxRef[t]??0),0);

  // ── Fonctions protegees par isLocked ─────────────────────────────────────
  const sauvegarderTaux=async()=>{
    if(isLocked){openUnlockModal();return;}
    setSavingTaux(true);
    try {
      const res=await fetch('/api/parametres',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({revenuMensuelReference:revenuRef,tauxReference:tauxRef})});
      if(res.ok){isDirty.current=false;setSavedTaux(true);setTimeout(()=>setSavedTaux(false),3000);await charger(true);}
      else{const err=await res.json();alert(`Erreur : ${err.error??'Inconnue'}`);}
    } catch(e){console.error(e);}
    finally{setSavingTaux(false);}
  };

  const sauvegarderBanqueLien=async(catId:string,banqueId:string|null)=>{
    if(isLocked)return;
    setSavingBanqueLien(catId);
    try {
      await fetch('/api/categories',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:catId,banqueId})});
      setCategories(prev=>prev.map(c=>c.id===catId?{...c,banqueId,banque:banqueId?banques.find((b:any)=>b.id===banqueId):null}:c));
    } catch(e){console.error(e);}
    finally{setSavingBanqueLien(null);}
  };

  const sauvegarderLien=async(catId:string,compteFondsId:string|null)=>{
    if(isLocked)return;
    setSavingLien(catId);
    try {
      await fetch('/api/categories',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:catId,compteFondsId})});
      setCategories(prev=>prev.map(c=>c.id===catId?{...c,compteFondsId,compteFonds:compteFondsId?comptes.find(cp=>cp.id===compteFondsId):null}:c));
    } catch(e){console.error(e);}
    finally{setSavingLien(null);}
  };

  const ajouterCategorie=async()=>{
    if(isLocked){openUnlockModal();return;}
    if(!newCat.nom)return;
    await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newCat)});
    setNewCat({nom:'',type:'depense_variable',sousType:''});setShowNewCat(false);chargerOnglet('categories');
  };

  const sauvegarderCat=async()=>{
    if(isLocked)return;
    if(!editCat)return;
    await fetch('/api/categories',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editCat)});
    setEditCat(null);chargerOnglet('categories');
  };

  const supprimerCat=async(id:string)=>{
    if(isLocked){openUnlockModal();return;}
    if(!confirm('Desactiver cette categorie ?'))return;
    await fetch(`/api/categories?id=${id}`,{method:'DELETE'});chargerOnglet('categories');
  };

  const ajouterCompte=async()=>{
    if(isLocked){openUnlockModal();return;}
    if(!newCompte)return;
    await fetch('/api/comptes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nom:newCompte,ordre:comptes.length})});
    setNewCompte('');setShowNewCompte(false);chargerOnglet('comptes');
  };

  const sauvegarderCompte=async()=>{
    if(isLocked)return;
    if(!editCompte)return;
    await fetch('/api/comptes',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editCompte)});
    setEditCompte(null);chargerOnglet('comptes');
  };

  const supprimerCompte=async(id:string)=>{
    if(isLocked){openUnlockModal();return;}
    if(!confirm('Desactiver ce compte ?'))return;
    await fetch(`/api/comptes?id=${id}`,{method:'DELETE'});chargerOnglet('comptes');
  };

  const importerExcel=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    if(isLocked){openUnlockModal();return;}
    const file=e.target.files?.[0];if(!file)return;
    setImporting(true);setImportResult(null);
    const fd=new FormData();fd.append('file',file);
    const res=await fetch('/api/import',{method:'POST',body:fd});
    setImportResult(await res.json());setImporting(false);e.target.value='';
  };

  if(loading)return<div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;

  const catsByType=ORDRE_TYPES.map(type=>({type,cats:categories.filter(c=>c.type===type&&c.isActive)})).filter(g=>g.cats.length>0);
  const fondsActifs=comptes.filter(c=>c.isActive);
  const inputCls="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-all";
  const actionBtn=(lk:boolean)=>clsx('flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all',
    lk?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-primary hover:bg-primary-dark text-white');
  const iconBtn=(lk:boolean)=>clsx('transition-colors',lk?'text-slate-200 dark:text-slate-700 cursor-not-allowed':'text-slate-300 dark:text-slate-600 hover:text-primary');
  const iconBtnDanger=(lk:boolean)=>clsx('transition-colors',lk?'text-slate-200 dark:text-slate-700 cursor-not-allowed':'text-slate-300 dark:text-slate-600 hover:text-red-500');

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Parametres</h1>
        <p className="text-[var(--text-muted)] text-sm">Gerez vos categories, comptes et donnees</p>
      </div>

      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)] flex-wrap">
        {(['categories','comptes','banques','import','donnees'] as const).map(tab=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab===tab?'bg-[var(--surface)] text-primary shadow-sm':'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {tab==='categories'?'Categories':tab==='comptes'?'Fonds':tab==='banques'?'Banques':tab==='donnees'?'Donnees':'Import Excel'}
          </button>
        ))}
      </div>

      {/* CATEGORIES */}
      {activeTab==='categories'&&(
        <div className="space-y-5">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-[var(--text)]">Budget de reference</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Revenu mensuel et taux par grande categorie</p>
              </div>
              <button onClick={sauvegarderTaux} disabled={savingTaux||isLocked}
                title={isLocked?'Verrouillez pour modifier':undefined}
                className={clsx('flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60',
                  isLocked?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-primary hover:bg-primary-dark text-white')}>
                {isLocked?<Lock size={13}/>:<Save size={14}/>}
                {savingTaux?'Sauvegarde...':savedTaux?'Sauvegarde OK':isLocked?'Verrouille':'Sauvegarder'}
              </button>
            </div>
            <div className="mb-5 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1 block">Revenu mensuel de reference (FCFA)</label>
                  <input type="number" value={revenuRef||''} placeholder="Ex: 500000" disabled={isLocked}
                    onChange={e=>{if(isLocked)return;isDirty.current=true;setRevenuRef(parseInt(e.target.value)||0);}}
                    className={clsx('w-full border rounded-xl px-3 py-2 text-sm outline-none',
                      isLocked?'border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed':'border-blue-300 dark:border-blue-700 bg-white dark:bg-dark-card text-[var(--text)] focus:border-primary')}/>
                </div>
                <div className="text-right">
                  <p className="text-xs text-blue-600 dark:text-blue-400">100%</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{formatFCFA(revenuRef)}</p>
                  <p className="text-xs text-blue-500">Fonds urgence x6 : {formatFCFA(revenuRef*6)}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {GRANDES_CATEGORIES.map(type=>{
                const taux=tauxRef[type]??0,isOver=totalTaux>100;
                return(
                  <div key={type} className="space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text)] w-52 flex-shrink-0">{TYPE_LABELS[type as keyof typeof TYPE_LABELS]}</span>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" max="100" step="0.5" value={taux||''} placeholder="0" disabled={isLocked}
                          onChange={e=>{if(isLocked)return;isDirty.current=true;setTauxRef(p=>({...p,[type]:parseFloat(e.target.value)||0}));}}
                          className={clsx('w-20 text-right border rounded-lg px-2 py-1.5 text-sm outline-none',
                            isLocked?'border-[var(--border)] bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed':'border-[var(--border)] bg-[var(--card)] text-[var(--text)] focus:border-primary')}/>
                        <span className="text-sm text-[var(--text-muted)]">%</span>
                      </div>
                      <span className="text-sm font-semibold text-primary w-36">{revenuRef>0?formatFCFA(montantPourTaux(taux)):'--'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full transition-all',isOver?'bg-red-500':taux>30?'bg-blue-500':taux>15?'bg-green-500':'bg-amber-400')} style={{width:`${Math.min(100,taux)}%`}}/>
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-10 text-right">{taux}%</span>
                    </div>
                  </div>
                );
              })}
              <div className={clsx('mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between rounded-xl px-3 py-2',
                totalTaux>100?'bg-red-50 dark:bg-red-900/20':totalTaux===100?'bg-green-50 dark:bg-green-900/20':'bg-amber-50 dark:bg-amber-900/20')}>
                <span className="text-sm font-bold text-[var(--text)]">Total alloue</span>
                <div className="flex items-center gap-3">
                  {revenuRef>0&&<span className="text-sm text-[var(--text-muted)]">{formatFCFA(Math.round((totalTaux/100)*revenuRef))} / {formatFCFA(revenuRef)}</span>}
                  <span className={clsx('text-sm font-bold px-3 py-1 rounded-lg',
                    totalTaux>100?'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400':
                    totalTaux===100?'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400':
                    'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400')}>
                    {totalTaux}%{totalTaux>100?' (depassement)':totalTaux<100?` (reste ${(100-totalTaux).toFixed(1)}%)`:''}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center flex-wrap gap-2">
            <p className="text-sm text-[var(--text-muted)]">{categories.filter(c=>c.isActive).length} categories actives</p>
            <div className="flex items-center gap-2">
              <button onClick={plierTousCats} className="flex items-center gap-1 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card"><ChevronsUpDown size={12}/>Tout plier</button>
              <button onClick={ouvrirTousCats} className="flex items-center gap-1 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card"><ChevronsDownUp size={12}/>Tout deployer</button>
              <button onClick={()=>{if(isLocked){openUnlockModal();return;}setShowNewCat(!showNewCat);}} disabled={isLocked}
                title={isLocked?'Verrouillez pour modifier':undefined}
                className={actionBtn(isLocked)}><Plus size={14}/>Ajouter</button>
            </div>
          </div>

          {showNewCat&&!isLocked&&(
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex flex-wrap gap-3 items-end transition-colors">
              <div className="flex-1 min-w-40"><label className="text-xs text-[var(--text-muted)] mb-1 block">Nom *</label><input type="text" value={newCat.nom} onChange={e=>setNewCat(n=>({...n,nom:e.target.value}))} placeholder="Nom" className={inputCls}/></div>
              <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Type *</label><select value={newCat.type} onChange={e=>setNewCat(n=>({...n,type:e.target.value}))} className="border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">{ORDRE_TYPES.map(t=><option key={t} value={t}>{TYPE_LABELS[t as keyof typeof TYPE_LABELS]}</option>)}</select></div>
              <div className="flex-1 min-w-32"><label className="text-xs text-[var(--text-muted)] mb-1 block">Sous-type</label><input type="text" value={newCat.sousType} onChange={e=>setNewCat(n=>({...n,sousType:e.target.value}))} placeholder="Ex: Habitation" className={inputCls}/></div>
              <div className="flex gap-2"><button onClick={ajouterCategorie} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14}/></button><button onClick={()=>setShowNewCat(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14}/></button></div>
            </div>
          )}

          {catsByType.map(({type,cats})=>(
            <div key={type} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-dark-card border-b border-[var(--border)] flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-dark-card/80 transition-colors select-none" onClick={()=>toggleCatGroup(type)}>
                <div className="flex items-center gap-2">
                  {catGroupsOpen[type]?<ChevronDown size={14} className="text-[var(--text-muted)] flex-shrink-0"/>:<ChevronRight size={14} className="text-[var(--text-muted)] flex-shrink-0"/>}
                  <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{TYPE_LABELS[type as keyof typeof TYPE_LABELS]}</span>
                  <span className="text-xs text-[var(--text-muted)] opacity-60">({cats.length})</span>
                </div>
                {(tauxRef[type as GrandeCategorie]??0)>0&&<span className="text-xs font-semibold text-primary">{tauxRef[type as GrandeCategorie]}% -- {formatFCFA(montantPourTaux(tauxRef[type as GrandeCategorie]))}</span>}
              </div>
              {catGroupsOpen[type]&&(
                <div className="divide-y divide-[var(--border)]">
                  {cats.map((cat:any)=>(
                    <div key={cat.id} className={clsx('px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors',!cat.isActive&&'opacity-40')}>
                      {editCat?.id===cat.id?(
                        <>
                          <input type="text" value={editCat.nom} onChange={e=>setEditCat((c:any)=>({...c,nom:e.target.value}))} className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none"/>
                          <button onClick={sauvegarderCat} className="text-green-500 hover:text-green-600"><Check size={15}/></button>
                          <button onClick={()=>setEditCat(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15}/></button>
                        </>
                      ):(
                        <>
                          <span className="flex-1 text-sm text-[var(--text)]">{cat.nom}</span>
                          {cat.sousType&&<span className="text-xs text-[var(--text-muted)]">{cat.sousType}</span>}
                          {type==='epargne_autre'&&cat.isActive&&(
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {savingLien===cat.id?<span className="text-xs text-primary animate-pulse">Liaison...</span>:(
                                <><select value={cat.compteFondsId??''} disabled={isLocked} onChange={e=>sauvegarderLien(cat.id,e.target.value||null)}
                                    className={clsx('text-xs border rounded-lg px-2 py-1 outline-none transition-all',isLocked?'opacity-40 cursor-not-allowed border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]':cat.compteFondsId?'border-primary/40 bg-primary/5 text-primary font-medium':'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]')}>
                                  <option value="">-- Non lie --</option>
                                  {fondsActifs.map((f:any)=><option key={f.id} value={f.id}>{f.nom}</option>)}
                                </select>
                                {cat.compteFondsId?<Link size={12} className="text-primary flex-shrink-0"/>:<Link2Off size={12} className="text-slate-300 flex-shrink-0"/>}</>
                              )}
                            </div>
                          )}
                          {(type==='epargne_investissement'||type==='epargne_precaution')&&cat.isActive&&(
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {savingBanqueLien===cat.id?<span className="text-xs text-primary animate-pulse">Liaison...</span>:(
                                <><select value={cat.banqueId??''} disabled={isLocked} onChange={e=>sauvegarderBanqueLien(cat.id,e.target.value||null)}
                                    className={clsx('text-xs border rounded-lg px-2 py-1 outline-none transition-all',isLocked?'opacity-40 cursor-not-allowed border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]':cat.banqueId?'border-blue-400/40 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium':'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]')}>
                                  <option value="">-- Non liee --</option>
                                  {banques.map((b:any)=><option key={b.id} value={b.id}>{b.nomBanque}</option>)}
                                </select>
                                {cat.banqueId?<span className="text-blue-500 text-xs">*B*</span>:<span className="opacity-30 text-xs">B</span>}</>
                              )}
                            </div>
                          )}
                          <button onClick={()=>{if(isLocked)return;setEditCat(cat);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtn(isLocked)}><Pencil size={13}/></button>
                          {cat.isActive&&<button onClick={()=>supprimerCat(cat.id)} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtnDanger(isLocked)}><Trash2 size={13}/></button>}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FONDS */}
      {activeTab==='comptes'&&(
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{comptes.filter(c=>c.isActive).length} fonds actifs</p>
            <button onClick={()=>{if(isLocked){openUnlockModal();return;}setShowNewCompte(!showNewCompte);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={actionBtn(isLocked)}><Plus size={14}/>Ajouter</button>
          </div>
          {showNewCompte&&!isLocked&&(
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex gap-3 items-end transition-colors">
              <div className="flex-1"><label className="text-xs text-[var(--text-muted)] mb-1 block">Nom du fond *</label><input type="text" value={newCompte} onChange={e=>setNewCompte(e.target.value)} placeholder="Ex: Fond scolarite" className={inputCls}/></div>
              <button onClick={ajouterCompte} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14}/></button>
              <button onClick={()=>setShowNewCompte(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14}/></button>
            </div>
          )}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] transition-colors">
            {comptes.map((c:any)=>(
              <div key={c.id} className={clsx('px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors',!c.isActive&&'opacity-40')}>
                {editCompte?.id===c.id?(
                  <>
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">{editCompte.nom.charAt(0)}</div>
                    <input type="text" value={editCompte.nom} onChange={e=>setEditCompte((p:any)=>({...p,nom:e.target.value}))} className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none"/>
                    <button onClick={sauvegarderCompte} className="text-green-500 hover:text-green-600"><Check size={15}/></button>
                    <button onClick={()=>setEditCompte(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15}/></button>
                  </>
                ):(
                  <>
                    <div className="w-8 h-8 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">{c.nom.charAt(0)}</div>
                    <span className="flex-1 text-sm text-[var(--text)] font-medium">{c.nom}</span>
                    <span className="text-sm font-bold text-primary">{formatFCFA(c.soldeActuel??0)}</span>
                    {categories.filter(cat=>cat.compteFondsId===c.id).length>0&&<span className="text-xs px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-medium flex items-center gap-1"><Link size={10}/>{categories.filter(cat=>cat.compteFondsId===c.id).length} cat.</span>}
                    {c.isActive&&<><button onClick={()=>{if(isLocked){openUnlockModal();return;}setEditCompte(c);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtn(isLocked)}><Pencil size={13}/></button><button onClick={()=>supprimerCompte(c.id)} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtnDanger(isLocked)}><Trash2 size={14}/></button></>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BANQUES */}
      {activeTab==='banques'&&(
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{banques.length} banque(s)</p>
            <button onClick={()=>{if(isLocked){openUnlockModal();return;}setShowNewBanque(!showNewBanque);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={actionBtn(isLocked)}><Plus size={14}/>Ajouter</button>
          </div>
          {showNewBanque&&!isLocked&&(
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex flex-wrap gap-3 items-end transition-colors">
              <div className="flex-1 min-w-40"><label className="text-xs text-[var(--text-muted)] mb-1 block">Nom *</label><input type="text" value={newBanque.nom} onChange={e=>setNewBanque(n=>({...n,nom:e.target.value}))} placeholder="Ex: BOA Yvan" className={inputCls}/></div>
              <div className="w-40"><label className="text-xs text-[var(--text-muted)] mb-1 block">Solde initial</label><input type="number" value={newBanque.solde} onChange={e=>setNewBanque(n=>({...n,solde:e.target.value}))} placeholder="0" className={inputCls}/></div>
              <div className="flex gap-2">
                <button onClick={async()=>{if(isLocked||!newBanque.nom)return;await fetch('/api/banques',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nomBanque:newBanque.nom,soldeInitial:parseInt(newBanque.solde)||0})});setNewBanque({nom:'',solde:''});setShowNewBanque(false);chargerOnglet('banques');}} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14}/></button>
                <button onClick={()=>setShowNewBanque(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14}/></button>
              </div>
            </div>
          )}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] transition-colors">
            {banques.length===0?<div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">Aucune banque.</div>:banques.map((b:any)=>(
              <div key={b.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                {editBanque?.id===b.id?(
                  <>
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">B</div>
                    <input type="text" value={editBanque.nomBanque} onChange={e=>setEditBanque((p:any)=>({...p,nomBanque:e.target.value}))} className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none"/>
                    <button onClick={async()=>{if(isLocked)return;await fetch(`/api/banques?id=${editBanque.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nomBanque:editBanque.nomBanque})});setEditBanque(null);chargerOnglet('banques');}} className="text-green-500 hover:text-green-600"><Check size={15}/></button>
                    <button onClick={()=>setEditBanque(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15}/></button>
                  </>
                ):(
                  <>
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm">B</div>
                    <span className="flex-1 text-sm text-[var(--text)] font-medium">{b.nomBanque}</span>
                    <span className="text-sm font-bold text-primary">{formatFCFA(b.solde)}</span>
                    <button onClick={()=>{if(isLocked){openUnlockModal();return;}setEditBanque(b);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtn(isLocked)}><Pencil size={13}/></button>
                    <button onClick={async()=>{if(isLocked){openUnlockModal();return;}if(!confirm('Supprimer ?'))return;await fetch(`/api/banques?id=${b.id}`,{method:'DELETE'});chargerOnglet('banques');}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtnDanger(isLocked)}><Trash2 size={14}/></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DONNEES */}
      {activeTab==='donnees'&&(
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <p className="font-semibold text-red-700 dark:text-red-400 text-sm mb-1">Zone dangereuse</p>
            <p className="text-xs text-red-600 dark:text-red-400">La suppression est irreversible.</p>
          </div>
          {anneesData.length===0?<div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-8 text-center text-[var(--text-muted)] text-sm">Aucune donnee</div>:
          anneesData.map((a:any)=>(
            <div key={a.id} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="font-bold text-[var(--text)]">{a.annee}</h3><p className="text-xs text-[var(--text-muted)] mt-0.5">{a.nbMois} mois - {a.nbDecaissements} operation(s)</p></div>
                <button onClick={()=>{if(isLocked){openUnlockModal();return;}setSuppAnnee(a.annee);setSuppMois(null);setConfirmText('');setSuppResult('');}} disabled={isLocked}
                  title={isLocked?'Verrouillez pour modifier':undefined}
                  className={clsx('px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',isLocked?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-red-500 hover:bg-red-600 text-white')}>
                  Supprimer {a.annee}
                </button>
              </div>
              {a.moisAvecDonnees.length>0&&(
                <div className="flex flex-wrap gap-2">
                  {a.moisAvecDonnees.map((m:number)=>(
                    <button key={m} onClick={()=>{if(isLocked){openUnlockModal();return;}setSuppAnnee(a.annee);setSuppMois(m);setConfirmText('');setSuppResult('');}} disabled={isLocked}
                      className={clsx('px-2.5 py-1 border rounded-lg text-xs transition-all',isLocked?'border-[var(--border)] text-[var(--text-muted)] opacity-40 cursor-not-allowed':'border-[var(--border)] text-[var(--text-muted)] hover:border-red-400 hover:text-red-500')}>
                      {['','Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'][m]} x
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {suppAnnee!==null&&(
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={()=>setSuppAnnee(null)}/>
              <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
                <h3 className="font-bold text-red-600 text-lg">Confirmer la suppression</h3>
                <p className="text-sm text-[var(--text)]">{suppMois?`Supprimer mois ${suppMois} / ${suppAnnee}.`:`Supprimer TOUTES les donnees de ${suppAnnee}.`}</p>
                <p className="text-sm font-semibold text-[var(--text)]">Tapez <span className="text-red-500 font-bold">{suppMois?`${suppAnnee}/${suppMois}`:String(suppAnnee)}</span> :</p>
                <input type="text" value={confirmText} onChange={e=>setConfirmText(e.target.value)} placeholder={suppMois?`${suppAnnee}/${suppMois}`:String(suppAnnee)} className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-red-400 outline-none"/>
                {suppResult&&<p className="text-sm text-green-600 font-medium">{suppResult}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={()=>{setSuppAnnee(null);setConfirmText('');}} className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all">Annuler</button>
                  <button disabled={suppLoading||(suppMois?confirmText!==`${suppAnnee}/${suppMois}`:confirmText!==String(suppAnnee))}
                    onClick={async()=>{setSuppLoading(true);const url=suppMois?`/api/donnees?annee=${suppAnnee}&mois=${suppMois}`:`/api/donnees?annee=${suppAnnee}`;const res=await fetch(url,{method:'DELETE'});const d=await res.json();setSuppResult(d.message??'Supprime');setSuppLoading(false);setConfirmText('');chargerOnglet('donnees');setTimeout(()=>{setSuppAnnee(null);setSuppResult('');},2000);}}
                    className="px-4 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-semibold transition-all disabled:opacity-40">
                    {suppLoading?'Suppression...':'Confirmer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* IMPORT */}
      {activeTab==='import'&&(
        <div className="space-y-4">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-2">Importer depuis Excel</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">Fichier <strong>BUDGET_MENSUEL_OK.xlsx</strong></p>
            {isLocked&&<div className="mb-4 flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3"><Lock size={14} className="text-amber-600 flex-shrink-0"/><p className="text-sm text-amber-700 dark:text-amber-400">Deverrouillez pour importer des donnees.</p></div>}
            <label className={clsx('flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl transition-all',
              isLocked?'border-[var(--border)] bg-slate-50 dark:bg-dark-card opacity-50 cursor-not-allowed':
              importing?'border-primary bg-primary/5 cursor-default':
              'border-[var(--border)] bg-slate-50 dark:bg-dark-card hover:border-primary hover:bg-primary/5 cursor-pointer')}>
              <Upload size={24} className={clsx('mb-2',importing?'text-primary animate-bounce':'text-[var(--text-muted)]')}/>
              <span className="text-sm font-medium text-[var(--text)]">{importing?'Import en cours...':isLocked?'Verrouille':'Cliquer pour selectionner'}</span>
              <span className="text-xs text-[var(--text-muted)] mt-1">.xlsx uniquement</span>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importerExcel} disabled={importing||isLocked}/>
            </label>
            {importResult&&(
              <div className={clsx('mt-4 p-4 rounded-xl text-sm',importResult.success?'bg-green-50 dark:bg-green-900/20 border border-green-200':'bg-red-50 dark:bg-red-900/20 border border-red-200')}>
                {importResult.success?(
                  <><p className="font-semibold text-green-700 dark:text-green-400 mb-2">Import termine</p>{Object.entries(importResult.results??{}).map(([yr,res]:any)=>(<div key={yr} className="text-green-600 dark:text-green-400"><span className="font-medium">{yr}</span> : <span>{res.imported} ligne(s)</span>{res.skipped>0&&<span className="ml-1">, {res.skipped} ignoree(s)</span>}</div>))}</>
                ):<p className="text-red-600 dark:text-red-400">{importResult.error}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
