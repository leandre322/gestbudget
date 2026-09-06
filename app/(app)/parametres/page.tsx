'use client';

// =============================================================================
// app/(app)/parametres/page.tsx  --  etape 6 (S14)
// =============================================================================
// P34  — double fetch au montage : charger() et chargerOnglet('categories')
//        partaient tous les deux, donc /api/categories et /api/comptes etaient
//        appeles deux fois. Le second effet ignore desormais le montage.
// Q40  — le MAX(tauxReference) sur d.categories disparait. Les taux et les
//        montants viennent de d.parType, calcule par lib/reference.ts a partir
//        de parametres_types. Plus aucune lecture de categories.tauxReference :
//        la colonne peut etre supprimee (expand/contract, etape 11).
// I3   — le PUT des taux transporte `version`. Un 409 signifie que les
//        parametres ont bouge ailleurs : on recharge au lieu d ecraser.
// P27  — nMoisUrgence est desormais renvoye par le GET et editable ici, borne
//        1-24 comme le CHECK en base. L objectif du fonds d urgence n est plus
//        code en dur a x6 : il vient du serveur (objectifUrgence).
// Q54  — le PUT applique une homothetie sur les categories. L ecriture ne doit
//        pas etre silencieuse : la reponse (mode par type, nombre de lignes
//        reequilibrees, alertes) est affichee apres la sauvegarde.
// P56  — sauvegarderCat envoie toujours l objet categorie complet ; le serveur
//        retire montantReference. Aucun changement necessaire ici, mais la
//        reponse peut contenir un bloc `repartition` (changement de type ou
//        desactivation) : il est restitue a l utilisateur.
// =============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Check, X, Upload, Save, Link, Link2Off,
         ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lock, AlertTriangle,
         Info } from 'lucide-react';
import { TYPE_LABELS, ORDRE_TYPES, formatFCFA } from '@/types';
import { clsx } from 'clsx';
import { PushSubscribeButton } from '@/components/notifications/PushSubscribeButton';
import { useLock } from '../contexts';

const GRANDES_CATEGORIES = [
  'epargne_precaution','epargne_investissement','epargne_autre',
  'depense_fixe','depense_variable','depense_occasionnelle','remboursement_dette',
] as const;
type GrandeCategorie = typeof GRANDES_CATEGORIES[number];

const LS_MODE_KEY = 'gb_cat_input_mode';

const N_MOIS_URGENCE_MIN = 1;
const N_MOIS_URGENCE_MAX = 24; // CHECK en base (S13)

const LIBELLE_MODE: Record<string, string> = {
  prorata:    'Prorata 12 mois',
  egal:       'Parts egales',
  homothetie: 'Rapports conserves',
  vide:       'Aucune categorie',
};

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
  const [activeTab,        setActiveTab]        = useState<'categories'|'comptes'|'banques'|'import'|'donnees'|'alertes'>('categories');

  // ── Taux & Revenus ────────────────────────────────────────────────────────
  const [tauxRef,    setTauxRef]    = useState<Record<GrandeCategorie, number>>({} as Record<GrandeCategorie, number>);
  const [montantRef, setMontantRef] = useState<Record<GrandeCategorie, number>>({} as Record<GrandeCategorie, number>);
  const [revenuRef,  setRevenuRef]  = useState<number>(0);
  const [nMoisUrgence,    setNMoisUrgence]    = useState<number>(6);
  const [objectifUrgence, setObjectifUrgence] = useState<number>(0);
  const [version,    setVersion]    = useState<string|null>(null);
  const [incoherents, setIncoherents] = useState<string[]>([]);
  const [savingTaux, setSavingTaux] = useState(false);
  const [savedTaux,  setSavedTaux]  = useState(false);
  const [tauxError,  setTauxError]  = useState<string | null>(null);
  const [repartitionInfo, setRepartitionInfo] = useState<any>(null);
  const [catMessage, setCatMessage] = useState<string | null>(null);

  // ── Mode saisie (Montant FCFA ou Taux %) ─────────────────────────────────
  const [inputMode, setInputMode] = useState<'montant' | 'taux'>('montant');
  useEffect(() => {
    const saved = localStorage.getItem(LS_MODE_KEY);
    if (saved === 'taux' || saved === 'montant') setInputMode(saved);
  }, []);

  const toggleInputMode = (mode: 'montant' | 'taux') => {
    setInputMode(mode);
    localStorage.setItem(LS_MODE_KEY, mode);
  };

  const [savingLien,       setSavingLien]       = useState<string|null>(null);
  const [savingBanqueLien, setSavingBanqueLien] = useState<string|null>(null);
  const [catGroupsOpen,    setCatGroupsOpen]    = useState<Record<string,boolean>>({});

  // ── Alertes ───────────────────────────────────────────────────────────────
  const [rapportEmailActif, setRapportEmailActif] = useState(true);
  const [rapportEmailJour,  setRapportEmailJour]  = useState(1);
  const [rapportEmailHeure, setRapportEmailHeure] = useState(8);
  const [seuilAnomaliesPct, setSeuilAnomaliesPct] = useState(50);
  const [langueVocale,      setLangueVocale]      = useState('fr-FR');
  const [savingAlertes,     setSavingAlertes]     = useState(false);
  const [savedAlertes,      setSavedAlertes]      = useState(false);

  const toggleCatGroup = (type: string) => setCatGroupsOpen(p => ({ ...p, [type]: !p[type] }));
  const ouvrirTousCats = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t]=true; }); setCatGroupsOpen(n); };
  const plierTousCats  = () => setCatGroupsOpen({});
  const isDirty        = useRef(false);
  const premierMontage = useRef(true); // P34

  // ── Conversions ───────────────────────────────────────────────────────────
  const tauxToMontant = (taux: number): number =>
    revenuRef > 0 ? Math.round((taux / 100) * revenuRef) : 0;

  const montantToTaux = (montant: number): number =>
    revenuRef > 0 ? Math.round((montant / revenuRef) * 10000) / 100 : 0;

  const totalTaux = GRANDES_CATEGORIES.reduce((s, t) => s + (tauxRef[t] ?? 0), 0);

  const totalBgCls = totalTaux > 100
    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
    : totalTaux >= 90
      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
      : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';

  const totalTextCls = totalTaux > 100
    ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
    : totalTaux >= 90
      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
      : 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400';

  const totalBarCls = totalTaux > 100
    ? 'bg-red-500'
    : totalTaux >= 90
      ? 'bg-amber-400'
      : 'bg-green-500';

  // ── Charger ───────────────────────────────────────────────────────────────
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
        const d = await rParams.json();
        if (!isDirty.current || force) {
          setRevenuRef(d.revenuMensuelReference ?? 0);
          setNMoisUrgence(d.nMoisUrgence ?? 6);
          setObjectifUrgence(d.objectifUrgence ?? 0);
          setVersion(d.version ?? null);

          // Q40 — source unique : d.parType, plus de MAX sur d.categories.
          const taux     = {} as Record<GrandeCategorie, number>;
          const montants = {} as Record<GrandeCategorie, number>;
          const desync: string[] = [];
          GRANDES_CATEGORIES.forEach(type => {
            const bloc = d.parType?.[type];
            taux[type]     = bloc?.taux    ?? 0;
            montants[type] = bloc?.montant ?? 0;
            if (bloc && bloc.coherent === false) desync.push(type);
          });
          setTauxRef(taux);
          setMontantRef(montants);
          setIncoherents(desync);

          setRapportEmailActif(d.rapportEmailActif ?? true);
          setRapportEmailJour(d.rapportEmailJour   ?? 1);
          setRapportEmailHeure(d.rapportEmailHeure ?? 8);
          setSeuilAnomaliesPct(d.seuilAnomaliesPct ?? 50);
          setLangueVocale(d.langueVocale ?? 'fr-FR');
          isDirty.current = false;
        }
      }
    } catch(e){ console.error('charger error:',e); }
    finally{ setLoading(false); }
  },[]);

  useEffect(() => { charger(); },[charger]);

  const handleRevenuChange = (newRevenu: number) => {
    if (isLocked) return;
    isDirty.current = true;
    setTauxError(null);
    setRepartitionInfo(null);
    setRevenuRef(newRevenu);
    setMontantRef(prev => {
      const m = { ...prev } as Record<GrandeCategorie, number>;
      GRANDES_CATEGORIES.forEach(type => {
        m[type] = newRevenu > 0 ? Math.round((tauxRef[type] ?? 0) / 100 * newRevenu) : 0;
      });
      return m;
    });
  };

  const sauvegarderAlertes = async () => {
    if (isLocked) { openUnlockModal(); return; }
    setSavingAlertes(true);
    try {
      // Pas de `version` ici : ce PUT ne touche pas a l allocation, un conflit
      // sur les taux ne doit pas bloquer un reglage d alerte.
      const res = await fetch('/api/parametres', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rapportEmailActif, rapportEmailJour, rapportEmailHeure,
          seuilAnomaliesPct, langueVocale,
        }),
      });
      if (res.ok) { setSavedAlertes(true); setTimeout(() => setSavedAlertes(false), 3000); }
    } catch(e){ console.error(e); }
    finally{ setSavingAlertes(false); }
  };

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

  // P34 — charger() a deja tout recupere au montage. Ce second effet ne doit
  // agir que sur les changements d onglet ulterieurs.
  useEffect(() => {
    if (premierMontage.current) { premierMontage.current = false; return; }
    chargerOnglet(activeTab);
  },[activeTab,chargerOnglet]);

  // ── Sauvegarder taux ──────────────────────────────────────────────────────
  const sauvegarderTaux = async () => {
    if (isLocked) { openUnlockModal(); return; }
    if (totalTaux > 100) {
      setTauxError('Total depasse 100% : reduire les depenses ou augmenter le revenu de reference.');
      return;
    }
    setTauxError(null);
    setRepartitionInfo(null);
    setSavingTaux(true);
    try {
      const res = await fetch('/api/parametres', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          revenuMensuelReference: revenuRef,
          nMoisUrgence,
          tauxReference: tauxRef,
          ...(version ? { version } : {}),
        }),
      });

      if (res.status === 409) {
        setTauxError(
          'Les parametres ont ete modifies ailleurs depuis le chargement de cette page. '
          + 'Les valeurs a l ecran ont ete rechargees : verifiez avant de sauvegarder a nouveau.'
        );
        isDirty.current = false;
        await charger(true);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setTauxError(err.error ?? 'Erreur inconnue');
        return;
      }

      const d = await res.json();
      isDirty.current = false;
      setSavedTaux(true);
      setTimeout(() => setSavedTaux(false), 3000);
      setRepartitionInfo({
        modeParType: d.repartition?.modeParType ?? [],
        nbCategoriesModifiees: d.repartition?.nbCategoriesModifiees ?? 0,
        nbRemisAZero: d.repartition?.nbRemisAZero ?? 0,
        invariantOk: d.repartition?.invariant?.ok ?? null,
        alertes: d.alertes ?? [],
      });
      await charger(true);
    } catch(e){
      console.error(e);
      setTauxError('Erreur reseau pendant la sauvegarde');
    }
    finally{ setSavingTaux(false); }
  };

  // ── Handlers categories / comptes / banques ────────────────────────────────
  const sauvegarderBanqueLien = async (catId:string, banqueId:string|null) => {
    if(isLocked)return;
    setSavingBanqueLien(catId);
    try {
      await fetch('/api/categories',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:catId,banqueId})});
      setCategories(prev=>prev.map(c=>c.id===catId?{...c,banqueId,banque:banqueId?banques.find((b:any)=>b.id===banqueId):null}:c));
    } catch(e){console.error(e);}
    finally{setSavingBanqueLien(null);}
  };

  const sauvegarderLien = async (catId:string, compteFondsId:string|null) => {
    if(isLocked)return;
    setSavingLien(catId);
    try {
      await fetch('/api/categories',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:catId,compteFondsId})});
      setCategories(prev=>prev.map(c=>c.id===catId?{...c,compteFondsId,compteFonds:compteFondsId?comptes.find(cp=>cp.id===compteFondsId):null}:c));
    } catch(e){console.error(e);}
    finally{setSavingLien(null);}
  };

  const ajouterCategorie = async () => {
    if(isLocked){openUnlockModal();return;}
    if(!newCat.nom.trim())return;
    const res = await fetch('/api/categories',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        nom: newCat.nom.trim(),
        type: newCat.type,
        sousType: newCat.sousType.trim() || null,
      }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      setCatMessage(d.info ?? 'Categorie creee.');
      setTimeout(() => setCatMessage(null), 8000);
    } else {
      const err = await res.json().catch(() => ({}));
      setCatMessage(err.error ?? 'Erreur lors de la creation');
      setTimeout(() => setCatMessage(null), 6000);
    }
    setNewCat({nom:'',type:'depense_variable',sousType:''});setShowNewCat(false);
    chargerOnglet('categories');
  };

  // Le serveur retire montantReference du body (P56) et declenche une
  // repartition si le type ou isActive change (P57).
  const sauvegarderCat = async () => {
    if(isLocked)return;
    if(!editCat)return;
    const res = await fetch('/api/categories',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ id: editCat.id, nom: editCat.nom, sousType: editCat.sousType ?? null }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.repartition) {
        setCatMessage(`Budgets de reference reequilibres : ${d.repartition.nbCategories} ligne(s).`);
        setTimeout(() => setCatMessage(null), 8000);
        charger(true);
      }
    }
    setEditCat(null);chargerOnglet('categories');
  };

  const supprimerCat = async (id:string) => {
    if(isLocked){openUnlockModal();return;}
    if(!confirm('Desactiver cette categorie ? Son budget de reference sera redistribue aux autres categories du meme type.'))return;
    const res = await fetch(`/api/categories?id=${id}`,{method:'DELETE'});
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.repartition) {
        setCatMessage(`Categorie desactivee. ${d.repartition.nbCategories} budget(s) reequilibre(s).`);
        setTimeout(() => setCatMessage(null), 8000);
      }
      charger(true);
    }
    chargerOnglet('categories');
  };

  const ajouterCompte = async () => {
    if(isLocked){openUnlockModal();return;}
    if(!newCompte)return;
    await fetch('/api/comptes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nom:newCompte,ordre:comptes.length})});
    setNewCompte('');setShowNewCompte(false);chargerOnglet('comptes');
  };

  const sauvegarderCompte = async () => {
    if(isLocked)return;
    if(!editCompte)return;
    await fetch('/api/comptes',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editCompte)});
    setEditCompte(null);chargerOnglet('comptes');
  };

  const supprimerCompte = async (id:string) => {
    if(isLocked){openUnlockModal();return;}
    if(!confirm('Desactiver ce compte ?'))return;
    await fetch(`/api/comptes?id=${id}`,{method:'DELETE'});chargerOnglet('comptes');
  };

  const importerExcel = async (e:React.ChangeEvent<HTMLInputElement>) => {
    if(isLocked){openUnlockModal();return;}
    const file=e.target.files?.[0];if(!file)return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setImportResult({ error: 'Format non supporte. Enregistrez le classeur au format .xlsx.' });
      e.target.value='';
      return;
    }

    setImporting(true);setImportResult(null);
    const fd=new FormData();fd.append('file',file);
    try {
      const res=await fetch('/api/import',{method:'POST',body:fd});
      setImportResult(await res.json());
    } catch {
      setImportResult({ error: 'Erreur reseau pendant l\u2019import' });
    }
    setImporting(false);e.target.value='';
  };

  if(loading)return<div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;

  const catsByType   = ORDRE_TYPES.map(type=>({type,cats:categories.filter(c=>c.type===type&&c.isActive)})).filter(g=>g.cats.length>0);
  const fondsActifs  = comptes.filter(c=>c.isActive);
  const inputCls     = "w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-all";
  const actionBtn    = (lk:boolean) => clsx('flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all',
    lk?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-primary hover:bg-primary-dark text-white');
  const iconBtn      = (lk:boolean) => clsx('transition-colors',lk?'text-slate-200 dark:text-slate-700 cursor-not-allowed':'text-slate-300 dark:text-slate-600 hover:text-primary');
  const iconBtnDanger = (lk:boolean) => clsx('transition-colors',lk?'text-slate-200 dark:text-slate-700 cursor-not-allowed':'text-slate-300 dark:text-slate-600 hover:text-red-500');

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Parametres</h1>
        <p className="text-[var(--text-muted)] text-sm">Gerez vos categories, comptes et donnees</p>
      </div>

      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)] flex-wrap">
        {(['categories','comptes','banques','import','donnees','alertes'] as const).map(tab=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab===tab?'bg-[var(--surface)] text-primary shadow-sm':'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {tab==='categories'?'Categories':tab==='comptes'?'Fonds':tab==='banques'?'Banques':tab==='donnees'?'Donnees':tab==='alertes'?'Alertes':'Import Excel'}
          </button>
        ))}
      </div>

      {/* ── CATEGORIES ─────────────────────────────────────────────────────── */}
      {activeTab==='categories'&&(
        <div className="space-y-5">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-[var(--text)]">Budget de reference</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Revenu mensuel et allocation par grande categorie</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex gap-0.5 bg-slate-100 dark:bg-dark-card rounded-lg p-0.5 border border-[var(--border)]">
                  {(['montant','taux'] as const).map(mode=>(
                    <button key={mode} onClick={()=>toggleInputMode(mode)}
                      className={clsx('px-3 py-1 rounded-md text-xs font-semibold transition-all',
                        inputMode===mode
                          ?'bg-white dark:bg-dark-surface text-primary shadow-sm'
                          :'text-[var(--text-muted)] hover:text-[var(--text)]')}>
                      {mode==='montant'?'Montant FCFA':'Taux %'}
                    </button>
                  ))}
                </div>
                <button
                  onClick={sauvegarderTaux}
                  disabled={savingTaux || isLocked || totalTaux > 100}
                  title={isLocked?'Verrouillez pour modifier':totalTaux>100?'Total depasse 100%':undefined}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60',
                    isLocked
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                      : totalTaux > 100
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 cursor-not-allowed'
                        : 'bg-primary hover:bg-primary-dark text-white'
                  )}>
                  {isLocked ? <Lock size={13}/> : totalTaux > 100 ? <AlertTriangle size={13}/> : <Save size={14}/>}
                  {savingTaux?'Sauvegarde...':savedTaux?'OK':isLocked?'Verrouille':totalTaux>100?'Depasse':'Sauvegarder'}
                </button>
              </div>
            </div>

            {/* Revenu + fonds d'urgence */}
            <div className="mb-5 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1 block">
                    Revenu mensuel de reference (FCFA)
                  </label>
                  <input type="number" value={revenuRef||''} placeholder="Ex: 700000" disabled={isLocked}
                    onChange={e=>handleRevenuChange(parseInt(e.target.value)||0)}
                    className={clsx('w-full border rounded-xl px-3 py-2 text-sm outline-none',
                      isLocked
                        ?'border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed'
                        :'border-blue-300 dark:border-blue-700 bg-white dark:bg-dark-card text-[var(--text)] focus:border-primary')}/>
                </div>
                <div className="w-40">
                  <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1 block">
                    Mois de fonds d&apos;urgence
                  </label>
                  <input type="number" min={N_MOIS_URGENCE_MIN} max={N_MOIS_URGENCE_MAX} step="1"
                    value={nMoisUrgence} disabled={isLocked}
                    onChange={e=>{
                      if(isLocked)return;
                      isDirty.current = true; setTauxError(null); setRepartitionInfo(null);
                      const v = parseInt(e.target.value) || N_MOIS_URGENCE_MIN;
                      setNMoisUrgence(Math.min(N_MOIS_URGENCE_MAX, Math.max(N_MOIS_URGENCE_MIN, v)));
                    }}
                    className={clsx('w-full border rounded-xl px-3 py-2 text-sm outline-none text-right',
                      isLocked
                        ?'border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed'
                        :'border-blue-300 dark:border-blue-700 bg-white dark:bg-dark-card text-[var(--text)] focus:border-primary')}/>
                  <p className="text-[10px] text-blue-500 mt-1">Entre {N_MOIS_URGENCE_MIN} et {N_MOIS_URGENCE_MAX}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-blue-600 dark:text-blue-400">100%</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{formatFCFA(revenuRef)}</p>
                  <p className="text-xs text-blue-500">
                    Fonds urgence x{nMoisUrgence} : {formatFCFA(objectifUrgence || revenuRef * nMoisUrgence)}
                  </p>
                </div>
              </div>
            </div>

            {incoherents.length > 0 && (
              <div className="mb-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5"/>
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Allocation desynchronisee sur {incoherents.length} type(s) : le montant enregistre ne correspond
                  plus au taux multiplie par le revenu. Sauvegardez pour recalculer.
                </span>
              </div>
            )}

            <div className="space-y-3">
              {GRANDES_CATEGORIES.map(type => {
                const taux = tauxRef[type] ?? 0;
                return (
                  <div key={type} className="space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text)] w-52 flex-shrink-0">
                        {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                      </span>
                      {inputMode === 'montant' ? (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min="0" step="1000" value={montantRef[type] || ''} placeholder="0" disabled={isLocked}
                            onChange={e => {
                              if (isLocked) return;
                              isDirty.current = true; setTauxError(null); setRepartitionInfo(null);
                              const m = parseInt(e.target.value) || 0;
                              const newTaux = montantToTaux(m);
                              setMontantRef(prev => ({ ...prev, [type]: m }));
                              setTauxRef(prev => ({ ...prev, [type]: newTaux }));
                            }}
                            className={clsx('w-32 text-right border rounded-lg px-2 py-1.5 text-sm outline-none',
                              isLocked?'border-[var(--border)] bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed':'border-[var(--border)] bg-[var(--card)] text-[var(--text)] focus:border-primary')}/>
                          <span className="text-xs text-[var(--text-muted)]">FCFA</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input type="number" min="0" max="100" step="0.5" value={taux||''} placeholder="0" disabled={isLocked}
                            onChange={e => {
                              if (isLocked) return;
                              isDirty.current = true; setTauxError(null); setRepartitionInfo(null);
                              const newTaux = parseFloat(e.target.value) || 0;
                              setTauxRef(prev => ({ ...prev, [type]: newTaux }));
                              setMontantRef(prev => ({ ...prev, [type]: tauxToMontant(newTaux) }));
                            }}
                            className={clsx('w-20 text-right border rounded-lg px-2 py-1.5 text-sm outline-none',
                              isLocked?'border-[var(--border)] bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed':'border-[var(--border)] bg-[var(--card)] text-[var(--text)] focus:border-primary')}/>
                          <span className="text-sm text-[var(--text-muted)]">%</span>
                        </div>
                      )}
                      <span className="text-sm font-semibold text-primary w-40">
                        {inputMode === 'montant'
                          ? (taux > 0 ? `${taux.toFixed(2)}%` : '0%')
                          : (revenuRef > 0 && taux > 0 ? formatFCFA(tauxToMontant(taux)) : '--')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full transition-all',
                          totalTaux > 100 ? 'bg-red-500' : taux > 30 ? 'bg-blue-500' : taux > 15 ? 'bg-green-500' : 'bg-amber-400')}
                          style={{width:`${Math.min(100,taux)}%`}}/>
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-12 text-right">{taux.toFixed(2)}%</span>
                    </div>
                  </div>
                );
              })}

              <div className="mt-3 mb-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[var(--text-muted)]">Allocation totale</span>
                  <span className={clsx('text-xs font-bold',totalTaux > 100 ? 'text-red-500' : totalTaux >= 90 ? 'text-amber-500' : 'text-green-600')}>
                    {totalTaux.toFixed(2)}%
                  </span>
                </div>
                <div className="h-3 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all duration-300', totalBarCls)} style={{width:`${Math.min(100, totalTaux)}%`}}/>
                </div>
              </div>

              <div className={clsx('mt-2 pt-3 border-t border-[var(--border)] flex items-center justify-between rounded-xl px-3 py-2', totalBgCls)}>
                <span className="text-sm font-bold text-[var(--text)]">Total alloue</span>
                <div className="flex items-center gap-3">
                  {revenuRef > 0 && (
                    <span className="text-sm text-[var(--text-muted)]">
                      {formatFCFA(Math.round((totalTaux/100)*revenuRef))} / {formatFCFA(revenuRef)}
                    </span>
                  )}
                  <span className={clsx('text-sm font-bold px-3 py-1 rounded-lg', totalTextCls)}>
                    {totalTaux.toFixed(2)}%
                    {totalTaux > 100 ? ' (depassement)' : totalTaux < 100 ? ` (reste ${(100-totalTaux).toFixed(2)}%)` : ''}
                  </span>
                </div>
              </div>

              {tauxError && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5"/>
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">{tauxError}</span>
                </div>
              )}

              {/* Q54 — restitution de l'ecriture appliquee sur les categories */}
              {repartitionInfo && (
                <div className="mt-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info size={14} className="text-blue-500 flex-shrink-0"/>
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                      Budgets de reference recalcules — {repartitionInfo.nbCategoriesModifiees} categorie(s) mise(s) a jour
                      {repartitionInfo.nbRemisAZero > 0 ? `, ${repartitionInfo.nbRemisAZero} remise(s) a zero` : ''}
                      {repartitionInfo.invariantOk === false ? ' — controle de coherence en echec' : ''}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {repartitionInfo.modeParType
                      .filter((b:any) => b.allocation > 0 || b.sommeAvant > 0)
                      .map((b:any) => (
                        <div key={b.type} className="flex items-center justify-between text-[11px] text-blue-700 dark:text-blue-300">
                          <span className="truncate">{TYPE_LABELS[b.type as keyof typeof TYPE_LABELS] ?? b.type}</span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span className="opacity-70">{LIBELLE_MODE[b.mode] ?? b.mode}</span>
                            <span className="opacity-70">{b.nbCategories} cat.</span>
                            <span className="font-semibold">{formatFCFA(b.allocation)}</span>
                          </span>
                        </div>
                      ))}
                  </div>
                  {repartitionInfo.alertes.length > 0 && (
                    <div className="pt-1 border-t border-blue-200 dark:border-blue-800 space-y-1">
                      {repartitionInfo.alertes.map((a:string, i:number) => (
                        <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">{a}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {catMessage && (
            <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5">
              <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/>
              <span className="text-xs text-blue-700 dark:text-blue-400">{catMessage}</span>
            </div>
          )}

          <div className="flex justify-between items-center flex-wrap gap-2">
            <p className="text-sm text-[var(--text-muted)]">{categories.filter(c=>c.isActive).length} categories actives</p>
            <div className="flex items-center gap-2">
              <button onClick={plierTousCats} className="flex items-center gap-1 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card"><ChevronsUpDown size={12}/>Tout plier</button>
              <button onClick={ouvrirTousCats} className="flex items-center gap-1 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card"><ChevronsDownUp size={12}/>Tout deployer</button>
              <button onClick={()=>{if(isLocked){openUnlockModal();return;}setShowNewCat(!showNewCat);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={actionBtn(isLocked)}><Plus size={14}/>Ajouter</button>
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
                {(tauxRef[type as GrandeCategorie]??0)>0&&(
                  <span className="text-xs font-semibold text-primary">
                    {(tauxRef[type as GrandeCategorie]).toFixed(2)}% → {formatFCFA(montantRef[type as GrandeCategorie] ?? 0)}
                  </span>
                )}
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
                          {cat.montantReference > 0 && (
                            <span className="text-xs text-[var(--text-muted)] flex-shrink-0" title="Budget de reference calcule">
                              {formatFCFA(cat.montantReference)}
                            </span>
                          )}
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
                                {cat.banqueId?<Link size={12} className="text-blue-500 flex-shrink-0"/>:<Link2Off size={12} className="text-slate-300 flex-shrink-0"/>}</>
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

      {/* ── FONDS ────────────────────────────────────────────────────────────── */}
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
                  <><div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">{editCompte.nom.charAt(0)}</div>
                  <input type="text" value={editCompte.nom} onChange={e=>setEditCompte((p:any)=>({...p,nom:e.target.value}))} className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none"/>
                  <button onClick={sauvegarderCompte} className="text-green-500 hover:text-green-600"><Check size={15}/></button>
                  <button onClick={()=>setEditCompte(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15}/></button></>
                ):(
                  <><div className="w-8 h-8 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">{c.nom.charAt(0)}</div>
                  <span className="flex-1 text-sm text-[var(--text)] font-medium">{c.nom}</span>
                  <span className="text-sm font-bold text-primary">{formatFCFA(c.soldeActuel??0)}</span>
                  {categories.filter(cat=>cat.compteFondsId===c.id).length>0&&<span className="text-xs px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-medium flex items-center gap-1"><Link size={10}/>{categories.filter(cat=>cat.compteFondsId===c.id).length} cat.</span>}
                  {c.isActive&&<><button onClick={()=>{if(isLocked){openUnlockModal();return;}setEditCompte(c);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtn(isLocked)}><Pencil size={13}/></button><button onClick={()=>supprimerCompte(c.id)} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtnDanger(isLocked)}><Trash2 size={14}/></button></>}</>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BANQUES ───────────────────────────────────────────────────────────── */}
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
                  <><div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">{(editBanque.nomBanque||'B').charAt(0)}</div>
                  <input type="text" value={editBanque.nomBanque} onChange={e=>setEditBanque((p:any)=>({...p,nomBanque:e.target.value}))} className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none"/>
                  <button onClick={async()=>{if(isLocked)return;await fetch(`/api/banques?id=${editBanque.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nomBanque:editBanque.nomBanque})});setEditBanque(null);chargerOnglet('banques');}} className="text-green-500 hover:text-green-600"><Check size={15}/></button>
                  <button onClick={()=>setEditBanque(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15}/></button></>
                ):(
                  <><div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm">{(b.nomBanque||'B').charAt(0)}</div>
                  <span className="flex-1 text-sm text-[var(--text)] font-medium">{b.nomBanque}</span>
                  <span className="text-sm font-bold text-primary">{formatFCFA(b.solde)}</span>
                  <button onClick={()=>{if(isLocked){openUnlockModal();return;}setEditBanque(b);}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtn(isLocked)}><Pencil size={13}/></button>
                  <button onClick={async()=>{if(isLocked){openUnlockModal();return;}if(!confirm('Supprimer ?'))return;await fetch(`/api/banques?id=${b.id}`,{method:'DELETE'});chargerOnglet('banques');}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined} className={iconBtnDanger(isLocked)}><Trash2 size={14}/></button></>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DONNEES ───────────────────────────────────────────────────────────── */}
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
                <button onClick={()=>{if(isLocked){openUnlockModal();return;}setSuppAnnee(a.annee);setSuppMois(null);setConfirmText('');setSuppResult('');}} disabled={isLocked} title={isLocked?'Verrouillez pour modifier':undefined}
                  className={clsx('px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',isLocked?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-red-500 hover:bg-red-600 text-white')}>
                  Supprimer {a.annee}
                </button>
              </div>
              {a.moisAvecDonnees.length>0&&(
                <div className="flex flex-wrap gap-2">
                  {a.moisAvecDonnees.map((m:number)=>(
                    <button key={m} onClick={()=>{if(isLocked){openUnlockModal();return;}setSuppAnnee(a.annee);setSuppMois(m);setConfirmText('');setSuppResult('');}} disabled={isLocked}
                      className={clsx('inline-flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs transition-all',isLocked?'border-[var(--border)] text-[var(--text-muted)] opacity-40 cursor-not-allowed':'border-[var(--border)] text-[var(--text-muted)] hover:border-red-400 hover:text-red-500')}>
                      {['','Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec'][m]}
                      <X size={11}/>
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

      {/* ── ALERTES ──────────────────────────────────────────────────────────── */}
      {activeTab==='alertes'&&(
        <div className="space-y-5">

          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-[var(--text)]">Rapport mensuel par email</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Bilan automatique : score, KPIs, epargne et anomalies</p>
              </div>
              <button onClick={()=>{if(isLocked){openUnlockModal();return;}setRapportEmailActif(p=>!p);}} disabled={isLocked}
                className={clsx('relative w-11 h-6 rounded-full transition-all flex-shrink-0',rapportEmailActif?'bg-green-500':'bg-slate-300 dark:bg-slate-600',isLocked&&'opacity-40 cursor-not-allowed')}>
                <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',rapportEmailActif?'translate-x-5':'translate-x-0')}/>
              </button>
            </div>
            {rapportEmailActif&&(
              <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2">
                Envoi automatique le <strong>1er de chaque mois a 06h00 UTC</strong>, avec le bilan du mois ecoule.
                Le jour et l&apos;heure ne sont plus reglables : le rapport est declenche par le cron mensuel unique.
              </p>
            )}
          </div>

          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-1">Detection d&apos;anomalies</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">Alerte Dashboard et email si une depense depasse la moyenne des 3 mois precedents</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-sm font-medium text-[var(--text)] flex-shrink-0 w-48">Seuil de declenchement</label>
                <input type="number" min="10" max="200" step="5" value={seuilAnomaliesPct} disabled={isLocked}
                  onChange={e=>{if(isLocked)return;setSeuilAnomaliesPct(Math.min(200,Math.max(10,parseInt(e.target.value)||50)));}}
                  className="w-24 border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none text-right"/>
                <span className="text-sm font-bold text-primary">%</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full transition-all',seuilAnomaliesPct>100?'bg-slate-400':seuilAnomaliesPct>50?'bg-amber-400':'bg-orange-500')}
                  style={{width:`${Math.min(100,(seuilAnomaliesPct/200)*100)}%`}}/>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {seuilAnomaliesPct<=30?'Tres sensible':seuilAnomaliesPct<=60?'Sensibilite standard':'Peu sensible'} → alerte si depense {'>'} {seuilAnomaliesPct}% au-dessus de la moyenne
              </p>
            </div>
          </div>

          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-1">Dictee vocale</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Langue utilisee pour la reconnaissance vocale dans le formulaire de decaissements.
              Maintenez le bouton micro pour dicter la description.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium text-[var(--text)] flex-shrink-0">Langue de reconnaissance</label>
              <select
                value={langueVocale}
                onChange={e => { if (isLocked) return; setLangueVocale(e.target.value); }}
                disabled={isLocked}
                className={clsx(
                  'border rounded-xl px-3 py-2 text-sm outline-none transition-all',
                  isLocked
                    ? 'border-[var(--border)] bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed opacity-60'
                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--text)] focus:border-primary'
                )}
              >
                <option value="fr-FR">Francais (France)</option>
                <option value="fr-BE">Francais (Belgique)</option>
                <option value="fr-CA">Francais (Canada)</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
              </select>
              <span className="text-xs text-[var(--text-muted)] italic">
                Parametre sauvegarde avec les alertes ci-dessous
              </span>
            </div>
          </div>

          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-1">Notifications push</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Recevez le bilan hebdomadaire chaque lundi à 8h directement sur
              cet appareil, sans application.{' '}
              <span className="text-amber-500 dark:text-amber-400">
                Safari iOS : l&apos;app doit être ajoutée à l&apos;écran d&apos;accueil.
              </span>
            </p>
            <PushSubscribeButton />
          </div>

          <div className="flex justify-end">
            <button onClick={sauvegarderAlertes} disabled={savingAlertes||isLocked}
              className={clsx('flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-60',
                isLocked?'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed':'bg-primary hover:bg-primary-dark text-white')}>
              {isLocked?<Lock size={13}/>:<Save size={13}/>}
              {savingAlertes?'Sauvegarde...':savedAlertes?'OK':isLocked?'Verrouille':'Sauvegarder'}
            </button>
          </div>
        </div>
      )}

      {/* ── IMPORT ────────────────────────────────────────────────────────────── */}
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
              <span className="text-xs text-[var(--text-muted)] mt-1">.xlsx uniquement — 8 Mo maximum</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={importerExcel} disabled={importing||isLocked}/>
            </label>
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Le format <strong>.xls</strong> n&apos;est plus accepte. Ouvrez le classeur dans Excel puis
              « Enregistrer sous » au format <strong>.xlsx</strong>.
            </p>
            {importResult&&(
              <div className={clsx('mt-4 p-4 rounded-xl text-sm',importResult.success?'bg-green-50 dark:bg-green-900/20 border border-green-200':'bg-red-50 dark:bg-red-900/20 border border-red-200')}>
                {importResult.success?(
                  <>
                    <p className="font-semibold text-green-700 dark:text-green-400 mb-2">Import termine</p>
                    {Object.entries(importResult.results??{}).map(([yr,res]:any)=>(
                      <div key={yr} className="text-green-600 dark:text-green-400">
                        <span className="font-medium">{yr}</span> : <span>{res.imported} ligne(s)</span>
                        {res.skipped>0&&<span className="ml-1">, {res.skipped} ignoree(s)</span>}
                        {res.unmatched?.length>0&&(
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 ml-2">
                            Non reconnues : {res.unmatched.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                ):<p className="text-red-600 dark:text-red-400">{importResult.error}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
