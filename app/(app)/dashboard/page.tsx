'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
         CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, PiggyBank, Wallet, AlertTriangle,
         Shield, ShieldOff, Building2, Pencil, X, Save,
         ArrowDownCircle, ArrowUpCircle, Bell, Loader2, Check, Plus, Minus } from 'lucide-react';
import { useMois, useLock } from '../contexts';
import { formatFCFA, MOIS_COURTS, calculerScore, couleurScore, LABEL_PREVISION } from '@/types';
import { useToast } from '@/components/Toast';
import { usePushNotifications } from '@/lib/hooks/usePushNotifications';
import { useDashboardGlobal, useBanques, useComptes, useCategories, useDashboardCumul, useRecapAnnuel, useAnomalies } from '@/lib/hooks/useDashboard';
import useSWR from 'swr';
import { clsx } from 'clsx';
import PilotageCards from '@/components/PilotageCards';

// ─────────────────────────────────────────────────────────────────────────────
// S12 — PASSE A. Ce fichier consomme desormais la nouvelle forme de
// /api/dashboard/global. Rappel de ce qui a change et pourquoi.
//
// P5/P6 — code mort
//   L'accordeon d'OngletRecap a ete supprime en S11 mais son etat est reste :
//   groupsOpen / setGroupsOpen / toggleGroup / toutDeployer / toutPlier, plus
//   les imports ORDRE_TYPES, TYPE_LABELS, ChevronDown, ChevronRight. Idem pour
//   recapLoading et mutateRecap, destructures de useRecapAnnuel sans usage.
//   BanniereContextuelle recevait depenses / moisCourant / anneeCourante sans
//   jamais les lire.
//
// P7 / Q19 — fin du 3 720 000 en dur
//   L'objectif du fonds d'urgence etait recalcule ici avec un `|| 3720000`.
//   Ce nombre en dur donnait un denominateur au 4e critere du score meme sans
//   configuration, donc un score flatteur sans fondement. L'objectif vient
//   maintenant de l'API (fondsUrgenceObjectif) et vaut 0 s'il n'est pas
//   configure ; l'ecran le dit au lieu de l'inventer.
//
// M5/M6/M7 — perimetre du fonds d'urgence
//   fondsUrgence etait la somme de TOUTES les banques. Il vient maintenant de
//   l'API, borne aux comptes marques compteUrgence. Deux grandeurs distinctes
//   coexistent desormais et ne doivent plus etre confondues :
//     - Epargne Precaution = patrimoine bancaire, tous comptes actifs
//     - Fonds urgence      = sous-ensemble mobilisable en cas de coup dur
//
// Q28 — toggle compteUrgence
//   Le flag n'etait pilotable qu'en SQL. Il se bascule depuis la carte de
//   chaque banque, avec confirmation : il deplace la barre d'urgence et le
//   score.
//
// P12 — fin de la deduplication par nom
//   L'API renvoie maintenant les 4 comptes BOA au lieu d'un seul. Rien a
//   changer ici, mais le bloc Epargne Precaution s'allonge mecaniquement.
//
// P24 — double fetch de /api/budget
//   DashboardPage faisait un fetch manuel et OngletGlobal un useSWR sur la
//   MEME URL : deux requetes par montage, et deux jeux de donnees divergents
//   (les alertes lisaient la version prop, les KPI la version SWR). Une seule
//   source desormais, portee par le parent.
//
// Q25 — non double comptage (regle posee dans schema.prisma / M8)
//   Un fonds adosse a une banque voit son argent compte par la banque. Le
//   calcul d'autonomie recoit totalFondsAutonome ; les cartes affichent le
//   detail complet avec un marqueur « adosse ».
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = ['#1E40AF','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#84CC16'];
const MOIS_NOMS_FR: Record<number,string> = {
  1:'Janvier',2:'Février',3:'Mars',4:'Avril',5:'Mai',6:'Juin',
  7:'Juillet',8:'Août',9:'Septembre',10:'Octobre',11:'Novembre',12:'Décembre',
};

// Date de resserrement du perimetre (M7). Affichee sous le pourcentage pour
// expliquer la chute du taux d'avancement, qui sinon ressemble a une regression.
const DATE_PERIMETRE = '05/09';

function JaugeCirculaire({ score, max=20 }: { score:number; max?:number }) {
  const [animated, setAnimated] = useState(0);
  useEffect(()=>{const t=setTimeout(()=>setAnimated(score),300);return()=>clearTimeout(t);},[score]);
  const radius=36, stroke=8, norm=radius-stroke/2, circ=2*Math.PI*norm;
  const pct=Math.min(animated/max,1), off=circ*(1-pct);
  const color=score>=16?'#10B981':score>=12?'#F59E0B':'#EF4444';
  const label=score>=16?'Excellent':score>=12?'Bon':'À améliorer';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={norm} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200 dark:text-slate-700"/>
          <circle cx="40" cy="40" r={norm} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 40 40)" style={{transition:'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)'}}/>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold leading-none" style={{color}}>{score}</span>
          <span className="text-[10px] text-[var(--text-muted)] leading-none">/20</span>
        </div>
      </div>
      <span className="text-[11px] font-semibold" style={{color}}>{label}</span>
    </div>
  );
}

function Sparkline({ data, color='#1E40AF', height=28, width=72 }: {data:number[];color?:string;height?:number;width?:number}) {
  if(!data||data.length<2)return null;
  const max=Math.max(...data,1),min=Math.min(...data,0),range=max-min||1,pad=2;
  const pts=data.map((v,i)=>({x:pad+(i/(data.length-1))*(width-pad*2),y:pad+(1-(v-min)/range)*(height-pad*2)}));
  const path=pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area=path+` L${pts[pts.length-1].x.toFixed(1)},${height} L${pts[0].x.toFixed(1)},${height} Z`;
  return (
    <svg width={width} height={height} className="opacity-70">
      <defs><linearGradient id={`g-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3"/><stop offset="100%" stopColor={color} stopOpacity="0.02"/></linearGradient></defs>
      <path d={area} fill={`url(#g-${color.replace('#','')})`}/><path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="2.5" fill={color}/>
    </svg>
  );
}

// P5 : la signature exposait depenses, moisCourant et anneeCourante, dont aucun
// n'etait lu dans le corps. Reduite a ce qui sert reellement.
function BannièreContextuelle({revenus,epargne,solde,score}:{revenus:number;epargne:number;solde:number;score:number}) {
  const [d,setD]=useState(false);if(d)return null;
  const tauxEp=revenus>0?(epargne/revenus)*100:0;
  const msgs:{type:string;emoji:string;text:string}[]=[];
  if(score>=18)msgs.push({type:'success',emoji:'🏆',text:`Score exceptionnel : ${score}/20 !`});
  if(tauxEp>=30)msgs.push({type:'success',emoji:'🐷',text:`Taux d'épargne excellent : ${tauxEp.toFixed(1)}%`});
  if(solde<0)msgs.push({type:'danger',emoji:'⚠️',text:`Solde négatif de ${formatFCFA(Math.abs(solde))}`});
  if(tauxEp<10&&revenus>0)msgs.push({type:'warning',emoji:'💡',text:`Taux d'épargne faible : ${tauxEp.toFixed(1)}%`});
  if(!msgs.length)return null;
  const msg=msgs[0];
  const s:Record<string,string>={success:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300',warning:'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',danger:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'};
  return(<div className={clsx('rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-sm font-medium',s[msg.type])}><span>{msg.emoji} {msg.text}</span><button onClick={()=>setD(true)} className="opacity-50 hover:opacity-100"><X size={15}/></button></div>);
}

function BannièreFinDeMois({moisCourant,anneeCourante}:{moisCourant:number;anneeCourante:number}) {
  const [d,setD]=useState(false);
  const today=new Date(),isCur=today.getMonth()+1===moisCourant&&today.getFullYear()===anneeCourante;
  const jours=isCur?(new Date(anneeCourante,moisCourant,0).getDate()-today.getDate()):99;
  if(d||jours>6||!isCur)return null;
  return(<div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2.5"><span className="text-lg">📅</span><div><p className="text-sm font-semibold text-orange-800 dark:text-orange-300">Fin de mois dans {jours} jour{jours>1?'s':''} !</p><p className="text-xs text-orange-600 dark:text-orange-400">Pensez à saisir vos données de {MOIS_NOMS_FR[moisCourant]} {anneeCourante}.</p></div></div><button onClick={()=>setD(true)} className="opacity-50 hover:opacity-100"><X size={15} className="text-orange-700 dark:text-orange-300"/></button></div>);
}

function DashboardModal({isOpen,onClose,titre,children}:{isOpen:boolean;onClose:()=>void;titre:string;children:React.ReactNode}) {
  if(!isOpen)return null;
  return(<div className="fixed inset-0 z-50 flex items-center justify-center"><div className="absolute inset-0 bg-black/50" onClick={onClose}/><div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"><div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-primary/5"><h3 className="font-bold text-[var(--text)]">✏️ {titre}</h3><button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18}/></button></div><div className="p-5 max-h-[65vh] overflow-y-auto">{children}</div></div></div>);
}

function Separateur({emoji,label}:{emoji:string;label:string}) {
  return(<div className="flex items-center gap-3"><span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">{emoji} {label}</span><div className="flex-1 border-t border-[var(--border)]"/></div>);
}

function EvoBadge({label,hausse,valStr}:{label:string;hausse:boolean;valStr:string}) {
  return(<span className={clsx('inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full',hausse?'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400':'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400')}>{hausse?'↑':'↓'} {label} {valStr}</span>);
}

// S10 — Bouton de reglage de seuil, factorise.
// Il existait en deux copies (fonds et banques) dont l'une avait perdu ses
// icones au profit des lettres "W" et "S" lors d'un deploiement PowerShell.
function IconeSeuil({ alerte, defini, size=11 }: { alerte:boolean; defini:boolean; size?:number }) {
  if (alerte)  return <AlertTriangle size={size}/>;
  if (defini)  return <Shield size={size}/>;
  return <Plus size={size}/>;
}

// ── Onglet Global ─────────────────────────────────────────────────────────────
function OngletGlobal({moisCourant,anneeCourante,budgetMois,loadingMois}:{moisCourant:number;anneeCourante:number;budgetMois:any[];loadingMois:boolean}) {
  const toast = useToast();
  const { isLocked, openUnlockModal } = useLock();
  const { status: pushStatus, subscribe: pushSubscribe, sendTest: pushTest } = usePushNotifications();

  const { data: _globalRaw, isLoading: _loadingGlobal, mutate: mutateGlobal } = useDashboardGlobal(moisCourant, anneeCourante);
  const { data: _banquesRaw, isLoading: _loadingBanques, mutate: mutateBanques } = useBanques();
  const { mutate: mutateComptes } = useComptes();
  const { data: _catsRaw } = useCategories();
  const { data: _cumulRaw, mutate: mutateCumul } = useDashboardCumul();

  // P24 : le useSWR sur /api/budget qui vivait ici doublonnait celui de
  // DashboardPage. La donnee arrive maintenant par la prop budgetMois, source
  // unique pour les KPI, les alertes et les modales.

  const { data: anomaliesData } = useAnomalies(moisCourant, anneeCourante);
  const banques = _banquesRaw?.banques ?? [];

  // fondsRoulement porte desormais objectif, seuilAlerte et banqueId, renvoyes
  // par /api/dashboard/global. Le merge avec /api/comptes (un find() par fonds,
  // donc quadratique) n'a plus de raison d'etre et ouvrait la porte a deux
  // valeurs divergentes pour le meme champ.
  const data = _globalRaw ? {
    ..._globalRaw,
    _categories: _catsRaw?.categories ?? [],
  } : null;
  const loading    = _loadingGlobal || _loadingBanques;
  const cumulData  = _cumulRaw ?? null;
  const correctifs = _cumulRaw?.correctifs ?? [];

  const [modalType,    setModalType]    = useState<string|null>(null);
  const [modalVals,    setModalVals]    = useState<Record<string,string>>({});
  const [savingModal,  setSavingModal]  = useState(false);
  const [sparklines,   setSparklines]   = useState({revenus:[] as number[],depenses:[] as number[],epargne:[] as number[],solde:[] as number[]});

  const [editingFondId,  setEditingFondId]  = useState<string|null>(null);
  const [editingFondVal, setEditingFondVal] = useState('');
  const [savingFondId,   setSavingFondId]   = useState<string|null>(null);

  const [evolutionFonds,   setEvolutionFonds]   = useState<Record<string,any[]>>({});
  const [evolutionBanques, setEvolutionBanques] = useState<Record<string,any[]>>({});

  const [editingSeuilId,    setEditingSeuilId]    = useState<string|null>(null);
  const [editingSeuilVal,   setEditingSeuilVal]   = useState('');
  const [savingSeuil,       setSavingSeuil]       = useState(false);
  const [editingFondSeuilId,  setEditingFondSeuilId]  = useState<string|null>(null);
  const [editingFondSeuilVal, setEditingFondSeuilVal] = useState('');
  const [savingFondSeuil,     setSavingFondSeuil]     = useState(false);

  // Q28 — bascule du perimetre d'urgence
  const [savingUrgenceId, setSavingUrgenceId] = useState<string|null>(null);

  const [banqueAjouts,  setBanqueAjouts]  = useState(0);
  const [banqueRetraits,setBanqueRetraits]= useState(0);

  // S10 — memoire anti-spam de la notification de seuil (voir useEffect plus bas)
  const alerteSeuilRef = useRef<string>('');

  // ── SUJET 3 : type etendu a 'solde' ──────────────────────────────────────
  const [showCorrectif,   setShowCorrectif]   = useState(false);
  const [correctifKpi,    setCorrectifKpi]    = useState<'revenus'|'depenses'|'epargne'|'solde'>('revenus');
  const [correctifMontant,setCorrectifMontant]= useState('');
  const [correctifSigne,  setCorrectifSigne]  = useState<1|-1>(1);
  const [correctifMotif,  setCorrectifMotif]  = useState('');
  const [savingCorrectif, setSavingCorrectif] = useState(false);

  const chargerBanqueKPIs = useCallback(async () => {
    try {
      const res = await fetch('/api/banques/mouvements?limit=5000');
      if (res.ok) {
        const d = await res.json();
        const mvts = d.mouvements ?? [];
        setBanqueAjouts(mvts.filter((m:any)=>m.typeMouvement==='ajout').reduce((s:number,m:any)=>s+Number(m.montant||0),0));
        setBanqueRetraits(mvts.filter((m:any)=>m.typeMouvement==='retrait').reduce((s:number,m:any)=>s+Number(m.montant||0),0));
      }
    } catch {}
  }, []);

  // ── S10 : sparklines en parallele ────────────────────────────────────────
  // Avant : 6 fetch SEQUENTIELS (await dans une boucle for), soit 6 fois la
  // latence Neon avant le premier pixel. Les 6 mois sont independants, donc
  // Promise.all. L'ordre chronologique est preserve par l'ordre du tableau.
  const chargerSparklines = useCallback(async () => {
    const cibles: {m:number;a:number}[] = [];
    for (let i=5;i>=0;i--) {
      let m=moisCourant-i, a=anneeCourante;
      if(m<=0){m+=12;a--;}
      cibles.push({m,a});
    }

    const reponses = await Promise.all(cibles.map(async ({m,a}) => {
      try {
        const res = await fetch(`/api/budget?annee=${a}&mois=${m}`);
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    }));

    const result = {revenus:[] as number[],depenses:[] as number[],epargne:[] as number[],solde:[] as number[]};
    for (const d of reponses) {
      if (!d) { result.revenus.push(0);result.depenses.push(0);result.epargne.push(0);result.solde.push(0); continue; }
      const b = d.budget ?? [];
      const rev=b.filter((x:any)=>x.categorie?.type==='revenu').reduce((s:number,x:any)=>s+x.montantReel,0);
      const dep=b.filter((x:any)=>x.categorie?.type?.startsWith('depense')||x.categorie?.type==='remboursement_dette').reduce((s:number,x:any)=>s+x.montantReel,0);
      const ep=b.filter((x:any)=>x.categorie?.type?.startsWith('epargne')).reduce((s:number,x:any)=>s+x.montantReel,0);
      result.revenus.push(rev);result.depenses.push(dep);result.epargne.push(ep);result.solde.push(rev-dep-ep);
    }
    setSparklines(result);
  }, [moisCourant, anneeCourante]);

  const chargerEvolutionFonds = useCallback(async (fonds:any[]) => {
    if (!fonds?.length) return;
    const results: Record<string,any[]> = {};
    await Promise.all(fonds.map(async (f:any) => {
      try {
        const res = await fetch(`/api/comptes/evolution?id=${f.id}`);
        if (!res.ok) return;
        const d = await res.json();
        const moisArr = d.mois ?? [];
        if (moisArr.length < 2) return;
        const last = moisArr.slice(-4);
        const badges = [];
        for (let i = Math.max(1, last.length-3); i < last.length; i++) {
          const prev = last[i-1].contribution ?? 0;
          const curr = last[i].contribution   ?? 0;
          const pct  = prev > 0 ? Math.round(Math.abs((curr-prev)/prev)*100) : (curr>0?100:0);
          badges.push({ label: last[i].label ?? '', pct, hausse: curr >= prev });
        }
        if (badges.length) results[f.id] = badges;
      } catch {}
    }));
    setEvolutionFonds(results);
  }, []);

  const chargerEvolutionBanques = useCallback(async (banquesList:any[]) => {
    if (!banquesList?.length) return;
    const results: Record<string,any[]> = {};
    await Promise.all(banquesList.map(async (b:any) => {
      try {
        const res = await fetch(`/api/banques/mouvements?banqueId=${b.id}&limit=200`);
        if (!res.ok) return;
        const d = await res.json();
        const mvts = d.mouvements ?? [];
        if (!mvts.length) return;
        const badges = [];
        for (let i=2;i>=0;i--) {
          const dt=new Date();dt.setDate(1);dt.setMonth(dt.getMonth()-i);
          const label=MOIS_COURTS[dt.getMonth()+1];
          const tM=dt.getMonth()+1, tA=dt.getFullYear();
          const mMvts=mvts.filter((m:any)=>{const d2=new Date(m.dateOperation);return d2.getMonth()+1===tM&&d2.getFullYear()===tA;});
          if(!mMvts.length)continue;
          const net=mMvts.reduce((s:number,m:any)=>s+(m.typeMouvement==='ajout'?(m.montant??0):-(m.montant??0)),0);
          badges.push({label,montant:Math.abs(net),hausse:net>=0});
        }
        if(badges.length)results[b.id]=badges;
      } catch {}
    }));
    setEvolutionBanques(results);
  }, []);

  const sauvegarderSeuilFond = async (fondId: string) => {
    setSavingFondSeuil(true);
    const seuil = parseInt(editingFondSeuilVal) || 0;
    try {
      const resFond = await fetch(`/api/comptes?id=${fondId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seuilAlerte: seuil }),
      });
      if (!resFond.ok) throw new Error('Echec sauvegarde seuil fond');
      toast.success(seuil > 0 ? 'Seuil fond defini' : 'Seuil supprime');
      setEditingFondSeuilId(null);
      mutateGlobal(); mutateBanques(); mutateComptes();
    } catch { toast.error('Erreur'); }
    setSavingFondSeuil(false);
  };

  // S12 : la reponse du PUT est desormais lue. La route valide le body (Zod)
  // et peut repondre 400 / 409 / 422 ; l'ancien appel ignorait le statut et
  // affichait "Seuil defini" meme quand rien n'avait ete ecrit.
  const sauvegarderSeuil = async (banqueId: string) => {
    setSavingSeuil(true);
    const seuil = parseInt(editingSeuilVal) || 0;
    try {
      const res = await fetch(`/api/banques?id=${banqueId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seuilAlerte: seuil }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Erreur');
      } else {
        toast.success(seuil > 0 ? 'Seuil defini' : 'Seuil supprime');
        setEditingSeuilId(null);
        mutateGlobal(); mutateBanques(); mutateComptes();
      }
    } catch { toast.error('Erreur reseau'); }
    setSavingSeuil(false);
  };

  // ── Q28 : bascule du perimetre d'urgence ────────────────────────────────
  // Deplacer un compte dans ou hors du perimetre change le numerateur du taux
  // d'avancement ET la 4e composante du score. Confirmation obligatoire :
  // c'est une decision de cadrage, pas un reglage d'affichage.
  const basculerCompteUrgence = async (b: any) => {
    if (isLocked) { openUnlockModal(); return; }
    const prochain = !b.compteUrgence;
    const question = prochain
      ? `Inclure ${b.nomBanque} (${formatFCFA(Number(b.solde||0))}) dans le fonds d'urgence ?`
      : `Retirer ${b.nomBanque} (${formatFCFA(Number(b.solde||0))}) du fonds d'urgence ?`;
    if (!confirm(`${question}\n\nLe taux d'avancement et le score seront recalcules.`)) return;

    setSavingUrgenceId(b.id);
    try {
      const res = await fetch(`/api/banques?id=${b.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compteUrgence: prochain }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Erreur');
      } else {
        toast.success(prochain ? 'Compte inclus dans le fonds urgence' : 'Compte retire du fonds urgence');
        mutateGlobal(); mutateBanques();
      }
    } catch { toast.error('Erreur reseau'); }
    setSavingUrgenceId(null);
  };

  useEffect(() => { chargerSparklines(); chargerBanqueKPIs(); }, [chargerSparklines, chargerBanqueKPIs]);

  // ── S10 : notification de seuil dedoublonnee ─────────────────────────────
  // Avant : une push partait a CHAQUE chargement du dashboard des qu'un seuil
  // etait franchi. Le `tag` ne dedoublonne que l'affichage cote navigateur,
  // pas l'envoi — donc autant d'appels a /api/push/send que de rafraichissements
  // (et autant d'invocations Vercel sur le quota Hobby).
  // Desormais : au plus un envoi par jour et par ensemble de comptes en alerte.
  // La cle contient la date, donc une alerte toujours active reprevient demain.
  useEffect(() => {
    if (!data || pushStatus !== 'granted') return;
    const alertesFonds = (data.fondsRoulement ?? []).filter((f:any) => {
      const seuil = Number(f.seuilAlerte ?? 0);
      return seuil > 0 && Number(f.soldeActuel ?? 0) < seuil;
    });
    const alertesBanques = banques.filter((b:any) => {
      const seuil = Number(b.seuilAlerte ?? 0);
      return seuil > 0 && Number(b.solde ?? 0) < seuil;
    });
    const total = alertesFonds.length + alertesBanques.length;
    if (total === 0) return;

    const signature = alertesFonds.map((f:any) => f.id)
      .concat(alertesBanques.map((b:any) => b.id))
      .sort()
      .join('|');
    const cle = `gb_alerte_seuil_${new Date().toISOString().slice(0,10)}_${signature}`;

    if (alerteSeuilRef.current === cle) return;
    alerteSeuilRef.current = cle;

    try {
      if (sessionStorage.getItem(cle)) return;
      sessionStorage.setItem(cle, '1');
    } catch {
      // sessionStorage indisponible (mode prive strict) : on retombe sur la
      // garde par ref, qui couvre au moins la duree de vie de la page.
    }

    fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: total + ' alerte(s) seuil actives',
        body: alertesFonds.map((f:any) => f.nom).concat(alertesBanques.map((b:any) => b.nomBanque)).join(', '),
        url: '/dashboard',
        tag: 'alerte-seuil-chargement',
      }),
    }).catch(() => {});
  }, [data, banques, pushStatus]);

  useEffect(() => { if(data?.fondsRoulement?.length>0)chargerEvolutionFonds(data.fondsRoulement); }, [data?.fondsRoulement?.length, chargerEvolutionFonds]);
  useEffect(() => { if(banques.length>0)chargerEvolutionBanques(banques); }, [banques, chargerEvolutionBanques]);

  // S10 : les trois etats rendaient le mot "Bell" en texte brut au lieu de
  // l'icone lucide — l'import etait pourtant present et inutilise.
  const renderPushButton = () => {
    if (pushStatus === 'unsupported') return null;
    if (pushStatus === 'granted') return (
      <button onClick={pushTest}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors">
        <Bell size={12}/> Notifs ON
      </button>
    );
    if (pushStatus === 'denied') return (
      <span className="text-[11px] text-red-400 px-2">Notifs bloquees</span>
    );
    return (
      <button onClick={pushSubscribe}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors">
        <Bell size={12}/> Activer notifs
      </button>
    );
  };

  const startEditFond = (f:any) => { if (isLocked) { openUnlockModal(); return; } setEditingFondId(f.id); setEditingFondVal(String(Number(f.soldeActuel??0))); };
  const cancelEditFond = () => { setEditingFondId(null); setEditingFondVal(''); };
  const saveEditFond = async (f:any) => {
    if (isLocked) return;
    const newSolde = parseInt(editingFondVal)||0;
    if (newSolde===Number(f.soldeActuel??0)){cancelEditFond();return;}
    const ancien = Number(f.soldeActuel??0);
    if (ancien>0 && Math.abs(newSolde-ancien)>ancien*2 && !confirm(`Modification de +-${formatFCFA(Math.abs(newSolde-ancien))}. Confirmer ?`)) return;
    setSavingFondId(f.id);
    try {
      const res = await fetch('/api/comptes/correction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({compteId:f.id,nouveauSolde:newSolde,motif:'Correction manuelle depuis Dashboard'})});
      if(res.ok){toast.success(`${f.nom} : solde mis a jour`);cancelEditFond();mutateGlobal();mutateComptes();}
      else{const err=await res.json();toast.error(err.error??'Erreur');}
    } catch{toast.error('Erreur reseau');}
    setSavingFondId(null);
  };

  // ── SUJET 3 : ouvrirCorrectif etendu a 'solde' ───────────────────────────
  const ouvrirCorrectif = (kpi:'revenus'|'depenses'|'epargne'|'solde') => {
    if (isLocked) { openUnlockModal(); return; }
    setCorrectifKpi(kpi);setCorrectifMontant('');setCorrectifMotif('');setCorrectifSigne(1);setShowCorrectif(true);
  };
  const sauvegarderCorrectif = async () => {
    if (isLocked) return;
    if (!correctifMontant||parseInt(correctifMontant)<=0){toast.error('Montant invalide');return;}
    if (!correctifMotif.trim()){toast.error('Motif obligatoire');return;}
    setSavingCorrectif(true);
    try {
      const res = await fetch('/api/correctifs-kpi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kpi:correctifKpi,montant:correctifSigne*parseInt(correctifMontant),motif:correctifMotif.trim()})});
      if(res.ok){toast.success('Correctif applique');setShowCorrectif(false);mutateCumul();}
      else{const err=await res.json();toast.error(err.error??'Erreur');}
    } catch{toast.error('Erreur reseau');}
    setSavingCorrectif(false);
  };
  const supprimerCorrectif = async (id:string) => {
    await fetch(`/api/correctifs-kpi?id=${id}`,{method:'DELETE'});
    mutateCumul();
  };

  // P24 : budgetMois est la source unique. Avant, budgetSource pointait sur un
  // second useSWR local et budgetMois n'alimentait plus que les alertes, qui
  // pouvaient donc contredire les KPI affiches juste au-dessus.
  const tot = (type:string, f:'montantAnticipe'|'montantReel') =>
    budgetMois.filter((b:any) => b.categorie?.isActive!==false &&
      (type==='epargne'?b.categorie?.type?.startsWith('epargne'):
       type==='depense'?(b.categorie?.type?.startsWith('depense')||b.categorie?.type==='remboursement_dette'):
       b.categorie?.type===type)
    ).reduce((s:number,b:any)=>s+b[f],0);

  const revenus  = {reel:tot('revenu','montantReel'),  ant:tot('revenu','montantAnticipe')};
  const epargne  = {reel:tot('epargne','montantReel'), ant:tot('epargne','montantAnticipe')};
  const depenses = {reel:tot('depense','montantReel'), ant:tot('depense','montantAnticipe')};
  const solde    = revenus.reel - epargne.reel - depenses.reel;

  // ── M7 / P7 : perimetre et objectif viennent de l'API ────────────────────
  // fondsUrgence n'est PLUS un reduce local sur toutes les banques : c'est la
  // somme des seuls comptes marques compteUrgence, calculee cote serveur.
  const fondsUrgence     = Number(data?.fondsUrgence ?? 0);
  const revenuRef        = Number(data?.revenuReference ?? 0);
  const nMoisUrgence     = Number(data?.nMoisUrgence ?? 6);
  const fondsObjectif    = Number(data?.fondsUrgenceObjectif ?? 0);
  const urgenceConfigure = Boolean(data?.urgenceConfigure);

  // Plus de `|| 3720000`. Quand l'objectif vaut 0, calculerScore garde son
  // 4e critere a 0/5 (division protegee cote types/index.ts) et l'ecran
  // signale explicitement que le score est incomplet.
  const {score,details} = calculerScore({totalDepenses:depenses.reel,totalDepAnt:depenses.ant,totalEpargne:epargne.reel,totalRevenus:revenus.reel,solde,fondsUrgence,fondsObjectif});
  const scoreTendance = (() => {
    if (sparklines.revenus.length < 2) return null;
    const n = sparklines.revenus.length;
    const calcS = (i: number) => { const rev = sparklines.revenus[i]??0, dep = sparklines.depenses[i]??0, ep = sparklines.epargne[i]??0; return calculerScore({ totalDepenses:dep, totalDepAnt:dep, totalEpargne:ep, totalRevenus:rev, solde:rev-dep-ep, fondsUrgence, fondsObjectif }).score; };
    const prev = calcS(n-2), curr = calcS(n-1);
    return { hausse: curr >= prev, pts: Math.abs(curr - prev) };
  })();
  const alertes = budgetMois.filter((b:any)=>b.categorie?.type?.startsWith('depense')&&b.montantAnticipe>0&&b.montantReel>b.montantAnticipe).map((b:any)=>b.categorie?.nom);

  const ouvrirModal = (type:string) => {
    if (isLocked) { openUnlockModal(); return; }
    const init:Record<string,string>={};
    if(type==='urgence'){init['revenu']=String(revenuRef);init['nMois']=String(nMoisUrgence);}
    else if(type==='banques'){banques.forEach((b:any)=>{init[b.id]=String(b.solde??0);});}
    else{budgetMois.filter((b:any)=>{if(type==='revenus')return b.categorie?.type==='revenu';if(type==='depenses')return b.categorie?.type?.startsWith('depense')||b.categorie?.type==='remboursement_dette';return false;}).forEach((b:any)=>{init[b.categorieId]=String(b.montantReel??0);});}
    setModalVals(init);setModalType(type);
  };

  const sauvegarderModal = async () => {
    if (isLocked) return;
    if(!modalType)return;setSavingModal(true);
    try {
      if(modalType==='urgence'){await fetch('/api/parametres',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revenuMensuelReference:parseInt(modalVals['revenu']||'0')||0,nMoisUrgence:parseInt(modalVals['nMois']||'6')||6})});toast.success("Fonds urgence mis a jour");}
      else if(modalType==='banques'){
        // Q14 mode B : chaque `action:'set'` ecrit desormais une ligne
        // mouvements_banque cote serveur, dans la meme transaction que le
        // solde. Les corrections faites ici cessent d'etre invisibles a
        // l'historique (constat S11 : 435 000 non journalises).
        for(const[id,s]of Object.entries(modalVals)){
          const res = await fetch(`/api/banques?id=${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set',montant:parseInt(s)||0,motif:'Correction de solde depuis le Dashboard'})});
          if(!res.ok){const err=await res.json().catch(()=>({}));toast.error(err.error??'Erreur sur un compte');}
        }
        toast.success('Soldes banques mis a jour');
      }
      else{const r=await fetch(`/api/budget?annee=${anneeCourante}&mois=${moisCourant}`);if(r.ok){const d=await r.json();const lignes:Record<string,any>={};for(const b of d.budget){lignes[b.categorieId]={anticipe:String(b.montantAnticipe??0),reel:modalVals[b.categorieId]!==undefined?modalVals[b.categorieId]:String(b.montantReel??0)};};await fetch('/api/budget',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({anneeId:d.anneeId,mois:moisCourant,lignes})});toast.success('Donnees mises a jour');}}
      mutateGlobal(); mutateBanques(); mutateComptes(); setModalType(null);
    } catch{toast.error('Erreur lors de la sauvegarde');}
    setSavingModal(false);
  };

  if(loading)return<div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;
  if(!data)return null;

  const {totalFonds, evolutionAnnuelle, fondsRoulement, totalAjouts, totalDecaissements} = data;
  const pctFonds = fondsObjectif>0?(fondsUrgence/fondsObjectif)*100:0;
  const barColor = pctFonds<50?'bg-red-500':pctFonds<80?'bg-orange-400':'bg-green-500';
  const textColor = pctFonds<50?'text-red-500':pctFonds<80?'text-orange-500':'text-green-600';

  // Q27 : deux grandeurs distinctes, a ne plus confondre.
  //   totalPrecaution = patrimoine bancaire (tous comptes actifs)
  //   fondsUrgence    = sous-ensemble mobilisable (compteUrgence = true)
  const totalPrecaution = banques.reduce((s:number,b:any)=>s+Number(b.solde??0),0);
  const banquesUrgence  = banques.filter((b:any)=>b.compteUrgence);

  // Q25 : les fonds adosses a une banque ne sont pas re-comptes dans le calcul
  // d'autonomie — leur argent est deja porte par le solde bancaire.
  const totalFondsAutonome = Number(data?.totalFondsAutonome ?? totalFonds ?? 0);

  const getBorderFond = (s:number,o:number) => { if(o<=0)return 'border-[var(--border)]'; const p=(s/o)*100; return p>=100?'border-green-500':p>=50?'border-amber-400':'border-primary/40'; };

  const cumRev   = cumulData?.totalRevenus  ?? data.totalRevenus  ?? 0;
  const cumDep   = cumulData?.totalDepenses ?? data.totalDepenses ?? 0;
  const cumEp    = cumulData?.totalEpargne  ?? 0;
  const cumSolde = cumulData?.soldeNet      ?? (data.solde ?? (cumRev - cumDep));

  // ── SUJET 3 : correctifs 'solde' appliques cote frontend ─────────────────
  const soldeCorrectifTotal = correctifs
    .filter((c:any) => c.kpi === 'solde')
    .reduce((s:number, c:any) => s + Number(c.montant), 0);
  const cumSoldeAvecCorrectif = cumSolde + soldeCorrectifTotal;

  const fondAjouts    = Number(totalAjouts        ?? 0);
  const fondRetraits  = Number(totalDecaissements ?? 0);

  // Q19 : scoreGlobal vaut null tant que l'objectif d'urgence n'est pas
  // configure. L'ancien `data?.scoreGlobal ?? score` retombait alors sur le
  // score du MOIS COURANT en le libellant "Score global" — un chiffre juste
  // sous une etiquette fausse.
  const scoreGlobalApi: number | null =
    data.scoreGlobal === null || data.scoreGlobal === undefined ? null : Number(data.scoreGlobal);

  return (
    <div className="space-y-5">

      {/* Modal correctif — titre etendu a 'solde' (SUJET 3) */}
      <DashboardModal isOpen={showCorrectif} onClose={()=>setShowCorrectif(false)}
        titre={`Correctif — ${
          correctifKpi === 'revenus'  ? 'Revenus'   :
          correctifKpi === 'depenses' ? 'Depenses'  :
          correctifKpi === 'epargne'  ? 'Epargne'   : 'Solde net'
        } cumule(e)s`}>
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
            Le correctif ajuste uniquement le total affiche sans modifier les donnees mensuelles.
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Sens</label>
            <div className="flex gap-2">
              <button onClick={()=>setCorrectifSigne(1)} className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 text-sm font-semibold transition-all',correctifSigne===1?'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700':'border-[var(--border)] text-[var(--text-muted)]')}><Plus size={14}/>Ajouter</button>
              <button onClick={()=>setCorrectifSigne(-1)} className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 text-sm font-semibold transition-all',correctifSigne===-1?'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600':'border-[var(--border)] text-[var(--text-muted)]')}><Minus size={14}/>Soustraire</button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant (FCFA)</label>
            <input type="number" value={correctifMontant} onChange={e=>setCorrectifMontant(e.target.value)} placeholder="Ex: 150000" className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Motif (obligatoire)</label>
            <input type="text" value={correctifMotif} onChange={e=>setCorrectifMotif(e.target.value)} placeholder="Ex: Correction solde initial" className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"/>
          </div>
          {correctifs.filter((c:any)=>c.kpi===correctifKpi).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">Correctifs existants :</p>
              <div className="space-y-1">
                {correctifs.filter((c:any)=>c.kpi===correctifKpi).map((c:any)=>(
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    <span className={clsx('font-bold flex-shrink-0',Number(c.montant)>=0?'text-green-600':'text-red-500')}>
                      {Number(c.montant)>=0?'+':''}{formatFCFA(Number(c.montant))}
                    </span>
                    <span className="text-[var(--text-muted)] truncate flex-1">{c.motif}</span>
                    <button onClick={()=>supprimerCorrectif(c.id)} className="text-slate-400 hover:text-red-500 flex-shrink-0"><X size={12}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <button onClick={()=>setShowCorrectif(false)} className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)]">Annuler</button>
            <button onClick={sauvegarderCorrectif} disabled={savingCorrectif} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-60">
              <Save size={14}/>{savingCorrectif?'Sauvegarde...':'Appliquer'}
            </button>
          </div>
        </div>
      </DashboardModal>

      <DashboardModal isOpen={modalType!==null} onClose={()=>setModalType(null)} titre={modalType==='urgence'?"Fonds urgence — Objectif":modalType==='banques'?'Epargne Precaution — Soldes':modalType==='revenus'?`Revenus — ${MOIS_NOMS_FR[moisCourant]} ${anneeCourante}`:modalType==='depenses'?`Depenses — ${MOIS_NOMS_FR[moisCourant]} ${anneeCourante}`:''}>
        <div className="space-y-3">
          {modalType==='urgence'&&(<div className="space-y-3"><div><label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Revenu mensuel de reference (FCFA)</label><input type="number" value={modalVals['revenu']??''} placeholder="Ex: 690 000" className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" onChange={e=>setModalVals(p=>({...p,revenu:e.target.value}))}/></div><div><label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Nombre de mois de precaution</label><input type="number" value={modalVals['nMois']??String(nMoisUrgence)} min="1" max="24" className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" onChange={e=>setModalVals(p=>({...p,nMois:e.target.value}))}/></div><div className="bg-primary/5 rounded-xl p-3"><p className="text-xs text-[var(--text-muted)]">Objectif calcule :</p><p className="text-lg font-bold text-primary mt-1">{formatFCFA((parseInt(modalVals['revenu']||'0')||0)*(parseInt(modalVals['nMois']||'6')||6))}</p></div></div>)}
          {modalType==='banques'&&(<div className="space-y-2"><p className="text-xs text-[var(--text-muted)] bg-slate-50 dark:bg-dark-card rounded-lg px-3 py-2">Chaque correction ecrit une ligne dans l&apos;historique du compte.</p>{banques.map((b:any)=>(<div key={b.id} className="flex items-center gap-3"><span className="flex-1 text-sm text-[var(--text)] font-medium">{b.nomBanque}{!b.compteUrgence&&<span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(hors urgence)</span>}</span><input type="number" value={modalVals[b.id]??''} placeholder="0" className="w-36 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" onChange={e=>setModalVals(p=>({...p,[b.id]:e.target.value}))}/></div>))}</div>)}
          {(modalType==='revenus'||modalType==='depenses')&&(<div className="space-y-2"><div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[var(--text-muted)] uppercase pb-2 border-b border-[var(--border)]"><span>Categorie</span><span className="text-right">{LABEL_PREVISION} - Reel</span></div>{budgetMois.filter((b:any)=>{if(modalType==='revenus')return b.categorie?.type==='revenu';if(modalType==='depenses')return b.categorie?.type?.startsWith('depense')||b.categorie?.type==='remboursement_dette';return false;}).map((b:any)=>(<div key={b.categorieId} className="flex items-center gap-3"><span className="flex-1 text-sm text-[var(--text)] truncate">{b.categorie?.nom}</span><div className="flex items-center gap-1.5 flex-shrink-0"><span className="text-xs text-[var(--text-muted)] w-24 text-right">{b.montantAnticipe>0?formatFCFA(b.montantAnticipe):'—'}</span><input type="number" value={modalVals[b.categorieId]??''} placeholder="0" className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" onChange={e=>setModalVals(p=>({...p,[b.categorieId]:e.target.value}))}/></div></div>))}</div>)}
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)] mt-4"><button onClick={()=>setModalType(null)} className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)]">Annuler</button><button onClick={sauvegarderModal} disabled={savingModal} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-white disabled:opacity-60"><Save size={14}/>{savingModal?'Sauvegarde...':'Sauvegarder'}</button></div>
        </div>
      </DashboardModal>

      <BannièreFinDeMois moisCourant={moisCourant} anneeCourante={anneeCourante}/>
      {(anomaliesData?.anomalies?.length ?? 0) > 0 && (<div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl px-4 py-3 flex items-start gap-2.5"><AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5"/><div><p className="text-sm font-semibold text-orange-800 dark:text-orange-300">{anomaliesData.anomalies.length} anomalie(s) ce mois vs moyenne 3 mois</p><div className="flex flex-wrap gap-1.5 mt-1">{anomaliesData.anomalies.map((a:any,i:number)=>(<span key={i} className="text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">{a.categorie} +{a.ecartPct}%</span>))}</div></div></div>)}

      <div className="flex items-center justify-end">{renderPushButton()}</div>

      <Separateur emoji="📅" label={`${MOIS_NOMS_FR[moisCourant]} ${anneeCourante} — Mois courant`}/>
      {!loadingMois && revenus.reel > 0 && (
        <BannièreContextuelle revenus={revenus.reel} epargne={epargne.reel} solde={solde} score={score}/>
      )}
      {loadingMois ? <div className="flex items-center justify-center h-20"><div className="spinner"/></div> : (
        <div className="space-y-3">
          {alertes.length > 0 && (<div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3.5 flex items-start gap-2.5"><AlertTriangle size={17} className="text-red-500 mt-0.5 flex-shrink-0"/><div><p className="font-semibold text-red-600 dark:text-red-400 text-sm">Depassements detectes ce mois</p><p className="text-red-500 dark:text-red-400 text-sm mt-0.5">{alertes.join(' - ')}</p></div></div>)}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              {titre:'Revenus',val:revenus.reel,ant:revenus.ant,type:'revenus',bg:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',text:'text-blue-700 dark:text-blue-400',icon:TrendingUp,sparkColor:'#1E40AF',sparkData:sparklines.revenus},
              {titre:'Depenses',val:depenses.reel,ant:depenses.ant,type:'depenses',bg:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',text:'text-red-600 dark:text-red-400',icon:TrendingDown,sparkColor:'#EF4444',sparkData:sparklines.depenses},
              {titre:'Epargne',val:epargne.reel,ant:epargne.ant,type:'',bg:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',text:'text-green-700 dark:text-green-400',icon:PiggyBank,sparkColor:'#10B981',sparkData:sparklines.epargne},
              {titre:'Solde',val:solde,ant:revenus.ant-epargne.ant-depenses.ant,type:'',bg:solde>=0?'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800':'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',text:solde>=0?'text-green-700 dark:text-green-400':'text-red-600 dark:text-red-400',icon:Wallet,sparkColor:solde>=0?'#10B981':'#EF4444',sparkData:sparklines.solde},
            ].map(k=>(
              <div key={k.titre} className={clsx('rounded-2xl border p-3.5 flex flex-col gap-0.5 transition-colors',k.bg)}>
                <div className="flex items-center justify-between"><p className="text-xs font-medium opacity-60">{k.titre}</p><div className="flex items-center gap-1"><k.icon size={15} className="opacity-40"/>{k.type&&<button onClick={()=>ouvrirModal(k.type)} disabled={isLocked} title={isLocked?"Verrouillez pour modifier":"Modifier"} className={isLocked?"p-1 rounded-lg opacity-20 cursor-not-allowed":"p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors"}><Pencil size={11} className="opacity-60"/></button>}</div></div>
                <p className={clsx('text-lg font-bold',k.text)}>{formatFCFA(k.val)}</p>
                <p className="text-xs opacity-55">Prevision : {formatFCFA(k.ant)}</p>
                {k.sparkData.length>=2&&<Sparkline data={k.sparkData} color={k.sparkColor} height={18} width={60}/>}
              </div>
            ))}
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 col-span-2 lg:col-span-1 flex flex-col items-center justify-center gap-2 transition-colors">
              <p className="text-xs font-medium text-purple-500 dark:text-purple-400">Score financier</p>
              <JaugeCirculaire score={score} max={20}/>
              {scoreTendance && (<div className={clsx('flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5',scoreTendance.hausse?'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400':'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400')}>{scoreTendance.pts > 0 ? (scoreTendance.hausse ? '+' : '-') + scoreTendance.pts + 'pt' : '='} vs M-1</div>)}
              <div className="w-full space-y-1 mt-1">{details.map((d:any,i:number)=>(
                <div key={i} className="flex items-center gap-1.5"><div className="flex-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={clsx('h-full rounded-full transition-all',d.pts>=d.max?'bg-green-500':d.pts>=d.max/2?'bg-amber-400':'bg-red-400')} style={{width:`${(d.pts/d.max)*100}%`}}/></div><span className="text-[10px] text-[var(--text-muted)] w-6 text-right">{d.pts}/{d.max}</span></div>
              ))}</div>
              {/* P7 : sans objectif d'urgence, le 4e critere vaut 0/5. On le dit
                  au lieu de laisser croire a une contre-performance. */}
              {!urgenceConfigure && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 text-center leading-tight mt-0.5">
                  Critere fonds urgence a 0/5 : objectif non configure
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <Separateur emoji="💰" label="Epargnes & Fonds"/>

      <PilotageCards
        revenusReel={revenus.reel}
        depensesReel={depenses.reel}
        epargneReel={epargne.reel}
        solde={solde}
        epargnePrecaution={totalPrecaution}
        totalFonds={totalFondsAutonome}
        depensesHistorique={sparklines.depenses}
        moisCourant={moisCourant}
        anneeCourante={anneeCourante}
      />

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--text)]">Epargne de Fonctionnement</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
          </div>
        </div>
        {(fondsRoulement??[]).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(fondsRoulement??[]).map((f:any) => {
              const soldeNum = Number(f.soldeActuel??0), objNum = Number(f.objectif??0);
              const seuilFond = Number(f.seuilAlerte??0);
              const isAlerteFond = seuilFond > 0 && soldeNum < seuilFond;
              const isEditingSeuil = editingFondSeuilId === f.id;
              const pct = objNum>0?Math.min(100,Math.round((soldeNum/objNum)*100)):null;
              const isEditing = editingFondId===f.id, isSaving = savingFondId===f.id;
              const evo = evolutionFonds[f.id]??[];
              const estAdosse = Boolean(f.banqueId);
              return (
                <div key={f.id} className={clsx('rounded-2xl border p-3.5 relative group transition-all hover:shadow-sm',isAlerteFond?'border-red-400 dark:border-red-600':getBorderFond(soldeNum,objNum))}>
                  <p className="text-xs font-medium text-[var(--text-muted)] truncate mb-1 pr-7">{f.nom}</p>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 mb-1">
                      <input type="number" value={editingFondVal} autoFocus onChange={e=>setEditingFondVal(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveEditFond(f);if(e.key==='Escape')cancelEditFond();}} className="flex-1 text-sm font-bold border border-primary rounded-lg px-2 py-1 bg-[var(--card)] text-primary outline-none min-w-0"/>
                      <button onClick={()=>saveEditFond(f)} disabled={isSaving} className="p-1.5 rounded-lg bg-green-500 text-white disabled:opacity-60 flex-shrink-0">{isSaving?<Loader2 size={12} className="animate-spin"/>:<Check size={12}/>}</button>
                      <button onClick={cancelEditFond} className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex-shrink-0"><X size={12}/></button>
                    </div>
                  ) : (
                    <p className="text-base font-bold text-primary cursor-text hover:text-primary-dark transition-colors" onClick={()=>startEditFond(f)} title={isLocked?"Verrouillez pour modifier":"Cliquer pour corriger"} style={isLocked?{cursor:"not-allowed",opacity:0.6}:{}}>{formatFCFA(soldeNum)}</p>
                  )}
                  {/* Q25 : marqueur de non double comptage. L'argent de ce fonds
                      est heberge par une banque, deja comptee au patrimoine. */}
                  {estAdosse && (
                    <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">Adosse a un compte bancaire</p>
                  )}
                  {pct!==null && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between mb-0.5"><span className="text-[10px] text-[var(--text-muted)]">Objectif</span><span className={clsx('text-[10px] font-bold',pct>=100?'text-green-600':pct>=50?'text-amber-500':'text-[var(--text-muted)]')}>{pct}%</span></div>
                      <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className={clsx('h-full rounded-full transition-all duration-500',pct>=100?'bg-green-500':pct>=50?'bg-amber-400':'bg-primary/60')} style={{width:`${Math.min(100,pct)}%`}}/></div>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{formatFCFA(objNum)}</p>
                    </div>
                  )}
                  {evo.length>0&&<div className="flex gap-1 mt-1.5 flex-wrap">{evo.map((e:any,i:number)=><EvoBadge key={i} label={e.label} hausse={e.hausse} valStr={`${e.pct}%`}/>)}</div>}
                  {isAlerteFond && !isEditing && (<div className="flex items-center gap-1 mt-0.5 text-xs text-red-500 font-semibold"><span>Sous le seuil ({formatFCFA(seuilFond)})</span></div>)}
                  {!isEditingSeuil && seuilFond > 0 && !isAlerteFond && (<p className="text-[10px] text-amber-500 mt-0.5">Seuil : {formatFCFA(seuilFond)}</p>)}
                  {isEditingSeuil && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <input type="number" value={editingFondSeuilVal} autoFocus placeholder="Seuil FCFA" onChange={e => setEditingFondSeuilVal(e.target.value)} onKeyDown={e => { if(e.key==="Enter") sauvegarderSeuilFond(f.id); if(e.key==="Escape") setEditingFondSeuilId(null); }} className="flex-1 text-xs border border-primary rounded-lg px-2 py-1 bg-[var(--card)] text-[var(--text)] outline-none min-w-0"/>
                      <button onClick={() => sauvegarderSeuilFond(f.id)} disabled={savingFondSeuil} className="p-1.5 rounded-lg bg-green-500 text-white disabled:opacity-60 flex-shrink-0">{savingFondSeuil ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>}</button>
                      <button onClick={() => setEditingFondSeuilId(null)} className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex-shrink-0"><X size={11}/></button>
                    </div>
                  )}
                  {!isEditing && !isEditingSeuil && (
                    <button onClick={() => { if(isLocked){openUnlockModal();return;} setEditingFondSeuilId(f.id); setEditingFondSeuilVal(String(seuilFond||"")); }}
                      title={isAlerteFond ? "Sous le seuil" : seuilFond > 0 ? "Modifier le seuil" : "Definir un seuil"}
                      className={clsx("absolute top-2 right-10 p-1.5 rounded-lg transition-all",
                        isAlerteFond ? "text-red-500 opacity-100" : seuilFond > 0 ? "text-amber-500 opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-50 text-slate-400 hover:text-amber-500")}>
                      <IconeSeuil alerte={isAlerteFond} defini={seuilFond > 0}/>
                    </button>
                  )}
                  {!isEditing&&<button onClick={()=>startEditFond(f)} disabled={isLocked} className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-[var(--border)] hover:bg-primary/10 text-[var(--text-muted)] hover:text-primary transition-all"><Pencil size={11}/></button>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] py-2">Aucun fond configure. <a href="/parametres" className="text-primary underline">Ajouter dans Parametres</a></p>
        )}
        {(fondsRoulement??[]).some((f:any)=>f.banqueId) && (
          <p className="text-[11px] text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border)]">
            Les fonds adosses a un compte bancaire ne sont pas recomptes dans le calcul d&apos;autonomie : leur argent est deja porte par le solde de la banque.
          </p>
        )}
      </div>

      {banques.filter((b:any)=>Number(b.seuilAlerte||0)>0&&Number(b.solde||0)<Number(b.seuilAlerte||0)).length>0&&(
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5"/>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Solde bas : {banques.filter((b:any)=>Number(b.seuilAlerte||0)>0&&Number(b.solde||0)<Number(b.seuilAlerte||0)).length} compte(s) en dessous du seuil</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {banques.filter((b:any)=>Number(b.seuilAlerte||0)>0&&Number(b.solde||0)<Number(b.seuilAlerte||0)).map((b:any)=>(
                <span key={b.id} className="text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
                  {b.nomBanque} : {formatFCFA(Number(b.solde||0))} / seuil {formatFCFA(Number(b.seuilAlerte||0))}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2"><Building2 size={17} className="text-primary"/><h3 className="font-semibold text-[var(--text)]">Epargne Precaution</h3></div>
          <div className="flex items-center gap-2"><span className="text-sm font-bold text-primary">{formatFCFA(totalPrecaution)}</span><button onClick={()=>ouvrirModal('banques')} disabled={isLocked} className={isLocked?"p-1.5 rounded-lg border border-[var(--border)] opacity-30 cursor-not-allowed":"p-1.5 rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-dark-card transition-colors"}><Pencil size={13} className="text-[var(--text-muted)]"/></button></div>
        </div>
        {/* Q27 : ce total est le patrimoine bancaire, pas le fonds d'urgence.
            Les deux etaient confondus avant le resserrement du perimetre. */}
        <p className="text-[11px] text-[var(--text-muted)] mb-4">
          Patrimoine bancaire, tous comptes actifs. Le bouclier marque les comptes retenus dans le fonds d&apos;urgence.
        </p>
        {(() => {
          const cats = data?._categories??[];
          const banquesInvestIds = new Set(cats.filter((c:any)=>c.type==='epargne_investissement'&&c.banqueId).map((c:any)=>c.banqueId));
          const renderCard = (b:any, accentCls:string, textCls:string) => {
            const evo = evolutionBanques[b.id]??[];
            const seuil = Number(b.seuilAlerte||0);
            const isAlerte = seuil > 0 && Number(b.solde||0) < seuil;
            const pctSeuil = seuil > 0 ? Math.round((Number(b.solde||0)/seuil)*100) : null;
            const isEditingSeuil = editingSeuilId === b.id;
            const dansUrgence = Boolean(b.compteUrgence);
            const savingUrg   = savingUrgenceId === b.id;
            return(
              <div key={b.id} className={clsx("rounded-2xl border p-3.5 relative group transition-all",
                isAlerte ? "border-red-400 dark:border-red-600" : "border-[var(--border)]", accentCls)}>
                <div className="flex items-center justify-between mb-1 gap-1">
                  <p className="text-xs text-[var(--text-muted)] font-medium truncate">{b.nomBanque}</p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Q28 : bascule du perimetre d'urgence */}
                    <button onClick={() => basculerCompteUrgence(b)} disabled={savingUrg}
                      title={dansUrgence ? "Compte retenu dans le fonds d'urgence — cliquer pour l'exclure" : "Compte exclu du fonds d'urgence — cliquer pour l'inclure"}
                      className={clsx("transition-all disabled:opacity-50",
                        dansUrgence ? "text-emerald-500 opacity-80 hover:opacity-100" : "text-slate-400 opacity-50 hover:opacity-100 hover:text-emerald-500")}>
                      {savingUrg ? <Loader2 size={12} className="animate-spin"/> : dansUrgence ? <Shield size={12}/> : <ShieldOff size={12}/>}
                    </button>
                    <button onClick={() => { if(isLocked){openUnlockModal();return;} setEditingSeuilId(b.id); setEditingSeuilVal(String(seuil||"")); }}
                      title={isAlerte ? "Sous le seuil" : seuil > 0 ? "Modifier le seuil" : "Definir un seuil"}
                      className={clsx("transition-all", isAlerte ? "text-red-500" : seuil > 0 ? "text-amber-500 opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-50 text-slate-400 hover:text-amber-500")}>
                      <IconeSeuil alerte={isAlerte} defini={seuil > 0} size={12}/>
                    </button>
                  </div>
                </div>
                <p className={clsx("text-base font-bold", isAlerte ? "text-red-500" : textCls)}>{formatFCFA(b.solde??0)}</p>
                {seuil > 0 && pctSeuil !== null && (
                  <div className="mt-1.5">
                    <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={clsx("h-full rounded-full transition-all", isAlerte ? "bg-red-500" : pctSeuil < 80 ? "bg-amber-400" : "bg-green-500")} style={{width:`${Math.min(100,pctSeuil)}%`}}/>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Seuil : {formatFCFA(seuil)} ({pctSeuil}%)</p>
                  </div>
                )}
                {isEditingSeuil && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <input type="number" value={editingSeuilVal} autoFocus placeholder="Seuil FCFA" onChange={e => setEditingSeuilVal(e.target.value)} onKeyDown={e => { if(e.key==="Enter") sauvegarderSeuil(b.id); if(e.key==="Escape") setEditingSeuilId(null); }} className="flex-1 text-xs border border-primary rounded-lg px-2 py-1 bg-[var(--card)] text-[var(--text)] outline-none min-w-0"/>
                    <button onClick={() => sauvegarderSeuil(b.id)} disabled={savingSeuil} className="p-1.5 rounded-lg bg-green-500 text-white disabled:opacity-60 flex-shrink-0">{savingSeuil ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>}</button>
                    <button onClick={() => setEditingSeuilId(null)} className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex-shrink-0"><X size={11}/></button>
                  </div>
                )}
                {evo.length>0&&<div className="flex gap-1 mt-1.5 flex-wrap">{evo.map((e:any,i:number)=><EvoBadge key={i} label={e.label} hausse={e.hausse} valStr={e.montant>0?`${(e.montant/1000).toFixed(0)}k`:"="}/>)}</div>}
              </div>
            );
          };
          const bp = banques.filter((b:any)=>!banquesInvestIds.has(b.id));
          const bi = banques.filter((b:any)=>banquesInvestIds.has(b.id));
          return(<>{bp.length>0&&<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">{bp.map((b:any)=>renderCard(b,'bg-[var(--surface)]','text-primary'))}</div>}{bi.length>0&&<div className="mt-2 pt-2 border-t border-[var(--border)]"><p className="text-xs text-[var(--text-muted)] mb-2">Compte lie (epargne investissement)</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{bi.map((b:any)=>renderCard(b,'bg-green-50 dark:bg-green-900/10','text-green-700 dark:text-green-400'))}</div></div>}</>);
        })()}
        {banques.length===0&&<p className="text-sm text-[var(--text-muted)] py-2">Aucune banque configuree. <a href="/parametres" className="text-primary underline">Ajouter dans Parametres - Banques</a></p>}
      </div>

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Shield size={17} className="text-primary"/><h3 className="font-semibold text-[var(--text)]">Fonds urgence</h3></div><div className="flex items-center gap-2">{urgenceConfigure&&<span className={clsx('text-sm font-bold',textColor)}>{pctFonds.toFixed(1)}%</span>}<button onClick={()=>ouvrirModal('urgence')} disabled={isLocked} className={isLocked?"p-1.5 rounded-lg border border-[var(--border)] opacity-30 cursor-not-allowed":"p-1.5 rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-dark-card"}><Pencil size={13} className="text-[var(--text-muted)]"/></button></div></div>
        {!urgenceConfigure ? (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4"><p className="text-sm font-semibold text-orange-700 dark:text-orange-400 mb-1">Revenu de reference non configure</p><p className="text-xs text-orange-600 dark:text-orange-400 mb-3">Objectif calcule : Revenu mensuel x Nombre de mois. Sans lui, le score reste incomplet.</p><div className="flex items-center justify-between"><div><p className="text-xs text-[var(--text-muted)]">Fonds urgence actuel</p><p className="text-lg font-bold text-primary">{formatFCFA(fondsUrgence)}</p></div><button onClick={()=>ouvrirModal('urgence')} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-xl text-xs font-medium"><Pencil size={12}/>Configurer</button></div></div>
        ) : (
          <>
            <div className="flex justify-between text-sm mb-2"><span className="font-medium text-[var(--text)]">{formatFCFA(fondsUrgence)}</span><span className="text-[var(--text-muted)]">Objectif : {formatFCFA(fondsObjectif)} <span className="text-xs">({nMoisUrgence}x{formatFCFA(revenuRef)})</span></span></div>
            <div className="h-3 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden"><div className={clsx('h-full rounded-full transition-all',barColor)} style={{width:`${Math.min(100,pctFonds)}%`}}/></div>
            <div className="flex justify-between mt-2 text-xs text-[var(--text-muted)]"><span className={clsx('font-medium',textColor)}>{pctFonds<50?'En dessous de 50%':pctFonds<80?'En bonne voie':'Objectif atteint'}</span><span>Reste : {formatFCFA(Math.max(0,fondsObjectif-fondsUrgence))}</span></div>
            {/* M7 : sans cette ligne, la chute du taux d'avancement au 05/09
                ressemble a une regression alors que c'est un changement de
                perimetre. */}
            <p className="text-[11px] text-[var(--text-muted)] mt-2 pt-2 border-t border-[var(--border)]">
              Perimetre resserre le {DATE_PERIMETRE} : {banquesUrgence.length} compte(s) sur {banques.length} retenus.
              {banquesUrgence.length > 0 && <span className="text-[var(--text)]"> {banquesUrgence.map((b:any)=>b.nomBanque).join(' · ')}</span>}
              {banquesUrgence.length === 0 && <span className="text-amber-600 dark:text-amber-400"> Aucun compte marque : le fonds urgence est a zero.</span>}
            </p>
          </>
        )}
      </div>

      {/* ═══════ STATS CUMULEES ═══════════════════════════════════════════════ */}
      <Separateur emoji="📊" label="Statistiques cumulees — toutes annees"/>
      {correctifs.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <span>{correctifs.length} correctif{correctifs.length>1?'s':''} applique{correctifs.length>1?'s':''} sur les totaux cumules.</span>
        </div>
      )}
      {/* SUJET 3 : kpi:'solde' + cumSoldeAvecCorrectif ─────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          {label:'Revenus cumules',   val:cumRev,               kpi:'revenus'  as const, bg:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',   text:'text-blue-700 dark:text-blue-400',   icon:TrendingUp},
          {label:'Depenses cumulees', val:cumDep,               kpi:'depenses' as const, bg:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',       text:'text-red-600 dark:text-red-400',     icon:TrendingDown},
          {label:'Epargne cumulee',   val:cumEp,                kpi:'epargne'  as const, bg:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', text:'text-green-700 dark:text-green-400', icon:PiggyBank},
          {label:'Solde net cumule',  val:cumSoldeAvecCorrectif, kpi:'solde'   as const,
            bg:cumSoldeAvecCorrectif>=0?'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800':'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
            text:cumSoldeAvecCorrectif>=0?'text-teal-700 dark:text-teal-400':'text-red-600 dark:text-red-400',icon:Wallet},
        ] as const).map(k=>(
          <div key={k.label} className={clsx('rounded-2xl border p-4 transition-colors',k.bg)}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              <div className="flex items-center gap-1">
                <k.icon size={15} className="opacity-40"/>
                {k.kpi && <button onClick={()=>ouvrirCorrectif(k.kpi as 'revenus'|'depenses'|'epargne'|'solde')} disabled={isLocked} title={isLocked?"Verrouillez pour modifier":"Appliquer un correctif"} className={isLocked?"p-1 rounded-lg opacity-20 cursor-not-allowed":"p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors"}><Pencil size={11} className="opacity-50"/></button>}
              </div>
            </div>
            <p className={clsx('text-lg font-bold',k.text)}>{formatFCFA(k.val)}</p>
            {k.label==='Solde net cumule' && (
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Rev - Dep - Epargne</p>
            )}
          </div>
        ))}
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 transition-colors col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-purple-500 dark:text-purple-400 mb-1">Score global</p>
          {scoreGlobalApi === null ? (
            <>
              <p className="text-2xl font-bold text-[var(--text-muted)]">—<span className="text-sm font-normal">/20</span></p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Objectif d&apos;urgence non configure</p>
            </>
          ) : (
            <>
              <p className={clsx('text-2xl font-bold',couleurScore(scoreGlobalApi))}>{scoreGlobalApi}<span className="text-sm text-[var(--text-muted)] font-normal">/20</span></p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{data?.nbMoisScore?`Moyenne sur ${data.nbMoisScore} mois`:'Toutes annees'}</p>
            </>
          )}
        </div>
      </div>

      <Separateur emoji="🔄" label="Ajouts & Decaissements — cumul"/>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {emoji:'📂',label:'Fonds ajoutes',    val:fondAjouts,    bg:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',    text:'text-green-700 dark:text-green-400',   icon:ArrowUpCircle},
          {emoji:'📂',label:'Fonds retires',    val:fondRetraits,  bg:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',            text:'text-red-600 dark:text-red-400',       icon:ArrowDownCircle},
          {emoji:'🏦',label:'Banques ajoutees', val:banqueAjouts,  bg:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',        text:'text-blue-700 dark:text-blue-400',     icon:ArrowUpCircle},
          {emoji:'🏦',label:'Banques retirees', val:banqueRetraits,bg:'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',text:'text-orange-600 dark:text-orange-400', icon:ArrowDownCircle},
        ].map(k=>(
          <div key={k.label} className={clsx('rounded-2xl border p-4 flex items-center gap-3 transition-colors',k.bg)}>
            <span className="text-xl flex-shrink-0">{k.emoji}</span>
            <div><p className={clsx('text-xs font-medium opacity-70',k.text)}>{k.label}</p><p className={clsx('text-base font-bold',k.text)}>{formatFCFA(k.val)}</p></div>
          </div>
        ))}
      </div>

      {(evolutionAnnuelle??[]).length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-4">Evolution annuelle</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={evolutionAnnuelle} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="annee" tick={{fontSize:12,fill:'var(--text-muted)'}}/>
              <YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>(v/1000000).toFixed(1)+'M'}/>
              <Tooltip formatter={(v:number)=>formatFCFA(v)}/>
              <Legend/>
              <Bar dataKey="revenus"  name="Revenus"  fill="#1E40AF" radius={[3,3,0,0]}/>
              <Bar dataKey="depenses" name="Depenses" fill="#EF4444" radius={[3,3,0,0]}/>
              <Bar dataKey="epargne"  name="Epargne"  fill="#10B981" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Onglet Recap ──────────────────────────────────────────────────────────────
function OngletRecap({moisCourant}:{moisCourant:number}) {
  const { isLocked } = useLock();
  const anneeActuelle=new Date().getFullYear();
  const [anneeSelect,setAnneeSelect]=useState(anneeActuelle);

  // SUJET 2 : recapData est la source principale (SWR)
  // P5 : recapLoading et mutateRecap etaient destructures sans usage.
  const { data: recapData } = useRecapAnnuel(anneeSelect, moisCourant);
  const [data,setData]=useState<any>(null);
  const [hist,setHist]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [exporting,setExporting]=useState<'excel'|'pdf'|null>(null);
  const [anneesDispos,setAnneesDispos]=useState<number[]>([anneeActuelle]);
  const [decStats,setDecStats]=useState({fondAjouts:0,fondRetraits:0,banqueAjouts:0,banqueRetraits:0});

  // P6 : groupsOpen / toggleGroup / toutDeployer / toutPlier et l'effet
  // d'initialisation sur ORDRE_TYPES pilotaient l'accordeon supprime en S11.
  // Aucun n'etait rendu. Supprimes avec leurs imports.

  useEffect(()=>{fetch('/api/annees').then(r=>r.json()).then(d=>{if(d.annees?.length){setAnneesDispos(d.annees);if(!d.annees.includes(anneeActuelle))setAnneeSelect(d.annees[d.annees.length-1]);}}).catch(()=>{});},[anneeActuelle]);

  // SUJET 2 fix A — charger avec recapData dans les deps (evite race condition)
  const charger=useCallback(async()=>{
    if (recapData) {
      const cats = recapData.categories ?? [];
      const budget = recapData.budget ?? [];
      setDecStats(recapData.decStats ?? {fondAjouts:0,fondRetraits:0,banqueAjouts:0,banqueRetraits:0});
      setData({budget,categories:cats});
      setHist(recapData.hist ?? []);
      setLoading(false);
      return;
    }
    // Fallback manuel quand SWR pas encore charge
    setLoading(true);try{const promises=Array.from({length:12},(_,i)=>fetch(`/api/budget?annee=${anneeSelect}&mois=${i+1}`).then(r=>r.ok?r.json():null));const results=await Promise.all(promises);const cats:any[]=results.find(r=>r?.categories?.length)?.categories??[];const budgetCumul:any[]=[];results.forEach(r=>{if(!r?.budget)return;r.budget.forEach((b:any)=>{const ex=budgetCumul.find(ab=>ab.categorieId===b.categorieId);if(ex){ex.montantAnticipe+=b.montantAnticipe??0;ex.montantReel+=b.montantReel??0;}else budgetCumul.push({...b,montantAnticipe:b.montantAnticipe??0,montantReel:b.montantReel??0});});});const histData=[];for(let i=5;i>=0;i--){let m=moisCourant-i,a=anneeSelect;if(m<=0){m+=12;a--;}const hr=results[m-1];histData.push({mois:MOIS_COURTS[m],ant:hr?.budget?.filter((b:any)=>b.categorie?.type?.startsWith('depense')).reduce((s:number,b:any)=>s+b.montantAnticipe,0)??0,reel:hr?.budget?.filter((b:any)=>b.categorie?.type?.startsWith('depense')).reduce((s:number,b:any)=>s+b.montantReel,0)??0});}const [resDec,resMvt]=await Promise.all([fetch(`/api/decaissements?annee=${anneeSelect}&limit=5000`),fetch('/api/banques/mouvements?limit=5000')]);let fondAjouts=0,fondRetraits=0,banqueAjouts=0,banqueRetraits=0;if(resDec.ok){const dd=await resDec.json();const decs=dd.decaissements??[];fondAjouts=decs.filter((d:any)=>d.typeMouvement==='ajout').reduce((s:number,d:any)=>s+(d.montantFond||d.montantTotal||0),0);fondRetraits=decs.filter((d:any)=>d.typeMouvement==='retrait').reduce((s:number,d:any)=>s+(d.montantFond||d.montantTotal||0),0);}if(resMvt.ok){const dm=await resMvt.json();const mvts=(dm.mouvements??[]).filter((m:any)=>new Date(m.dateOperation).getFullYear()===anneeSelect);banqueAjouts=mvts.filter((m:any)=>m.typeMouvement==='ajout').reduce((s:number,m:any)=>s+(m.montant||0),0);banqueRetraits=mvts.filter((m:any)=>m.typeMouvement==='retrait').reduce((s:number,m:any)=>s+(m.montant||0),0);}setDecStats({fondAjouts,fondRetraits,banqueAjouts,banqueRetraits});setData({budget:budgetCumul,categories:cats});setHist(histData);}catch(e){console.error(e);}setLoading(false);
  // SUJET 2 fix B — recapData dans les deps (re-run quand SWR resout)
  },[anneeSelect,moisCourant,recapData]);

  useEffect(()=>{charger();},[charger]);

  // SUJET 2 fix C — sync direct depuis SWR (filet de securite)
  useEffect(()=>{
    if(!recapData)return;
    setDecStats(recapData.decStats??{fondAjouts:0,fondRetraits:0,banqueAjouts:0,banqueRetraits:0});
    setData({budget:recapData.budget??[],categories:recapData.categories??[]});
    setHist(recapData.hist??[]);
    setLoading(false);
  },[recapData]);

  const exportExcel=async()=>{if(!window.confirm(`Exporter GestBudget-${anneeSelect}.xlsx ?`))return;setExporting('excel');const res=await fetch(`/api/export/excel?annee=${anneeSelect}`);if(res.ok){const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`GestBudget-${anneeSelect}.xlsx`;a.click();}setExporting(null);};
  const exportPDF=async()=>{if(!window.confirm(`Exporter PDF ${anneeSelect} ?`))return;setExporting('pdf');const res=await fetch(`/api/export/pdf?annee=${anneeSelect}&mois=${moisCourant}`);if(res.ok){const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`GestBudget-${anneeSelect}-${String(moisCourant).padStart(2,'0')}.pdf`;a.click();}setExporting(null);};

  if(loading)return<div className="flex items-center justify-center h-64"><div className="spinner scale-150"/></div>;
  const budget=data?.budget??[],cats=data?.categories??[];
  const totType=(type:string,field:'montantAnticipe'|'montantReel')=>budget.filter((b:any)=>type==='depense'?(b.categorie?.type?.startsWith('depense')||b.categorie?.type==='remboursement_dette'):b.categorie?.type===type).reduce((s:number,b:any)=>s+b[field],0);
  const revReel=totType('revenu','montantReel'),depReel=totType('depense','montantReel'),epReel=budget.filter((b:any)=>b.categorie?.type?.startsWith('epargne')).reduce((s:number,b:any)=>s+b.montantReel,0),solde=revReel-depReel-epReel;
  const fondsCategories=cats.filter((c:any)=>c.type==='epargne_autre');
  const totalFondsRecap=fondsCategories.reduce((s:number,cat:any)=>{const b=budget.find((b:any)=>b.categorieId===cat.id);return s+(b?.montantReel??0);},0);
  const donut=Object.entries(budget.filter((b:any)=>b.categorie?.type?.startsWith('depense')&&b.montantReel>0).reduce((acc:any,b:any)=>{const k=b.categorie?.sousType??'Autre';acc[k]=(acc[k]??0)+b.montantReel;return acc;},{})).map(([name,value])=>({name,value}));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2"><span className="text-sm font-medium text-[var(--text-muted)]">Annee :</span><div className="flex gap-1">{anneesDispos.map(a=>(<button key={a} onClick={()=>setAnneeSelect(a)} className={clsx('px-3 py-1.5 rounded-xl text-sm font-semibold transition-all',anneeSelect===a?'bg-primary text-white':'border border-[var(--border)] text-[var(--text-muted)] hover:border-primary hover:text-primary')}>{a}</button>))}</div></div>
        <div className="flex gap-2"><button onClick={exportExcel} disabled={exporting==='excel'||isLocked} className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-dark-card disabled:opacity-60">{exporting==='excel'?'Export...':'Excel'}</button><button onClick={exportPDF} disabled={exporting==='pdf'} className="flex items-center gap-1.5 bg-primary text-white rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60">{exporting==='pdf'?'Export...':'PDF'}</button></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[{label:`Revenus ${anneeSelect}`,val:revReel,cls:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'},{label:`Depenses ${anneeSelect}`,val:depReel,cls:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'},{label:`Epargne ${anneeSelect}`,val:epReel,cls:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'},{label:'Solde annuel',val:solde,cls:solde>=0?'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400':'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'},].map(k=>(<div key={k.label} className={clsx('rounded-2xl border p-3.5 transition-colors',k.cls)}><p className="text-xs font-medium opacity-60">{k.label}</p><p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p></div>))}</div>
      {fondsCategories.length>0&&(<div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors"><div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-[var(--text)]">Epargne de Fonctionnement {anneeSelect}</h3><span className="text-sm font-bold text-primary">{formatFCFA(totalFondsRecap)}</span></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{fondsCategories.map((cat:any)=>{const b=budget.find((b:any)=>b.categorieId===cat.id);return(<div key={cat.id} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 text-center"><p className="text-xs text-[var(--text-muted)] font-medium truncate">{cat.nom}</p><p className="text-base font-bold text-primary mt-1">{formatFCFA(b?.montantReel??0)}</p></div>);})}</div></div>)}
      <Separateur emoji="🔄" label={`Ajouts & Decaissements — ${anneeSelect}`}/>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[{emoji:'📂',label:'Fonds ajoutes',val:decStats.fondAjouts,bg:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',text:'text-green-700 dark:text-green-400'},{emoji:'📂',label:'Fonds retires',val:decStats.fondRetraits,bg:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',text:'text-red-600 dark:text-red-400'},{emoji:'🏦',label:'Banques ajoutees',val:decStats.banqueAjouts,bg:'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',text:'text-blue-700 dark:text-blue-400'},{emoji:'🏦',label:'Banques retirees',val:decStats.banqueRetraits,bg:'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',text:'text-orange-600 dark:text-orange-400'},].map(k=>(<div key={k.label} className={clsx('rounded-2xl border p-4 flex items-center gap-3 transition-colors',k.bg)}><span className="text-xl flex-shrink-0">{k.emoji}</span><div><p className={clsx('text-xs font-medium opacity-70',k.text)}>{k.label}</p><p className={clsx('text-base font-bold',k.text)}>{formatFCFA(k.val)}</p></div></div>))}</div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors"><h3 className="font-semibold text-[var(--text)] mb-3">Repartition depenses</h3>{donut.length>0?(<ResponsiveContainer width="100%" height={220}><PieChart><Pie data={donut} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={2}>{donut.map((_:any,i:number)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v:number)=>formatFCFA(v)}/></PieChart></ResponsiveContainer>):(<div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">Aucune depense cette annee</div>)}</div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors"><h3 className="font-semibold text-[var(--text)] mb-3">Depenses — 6 derniers mois</h3><ResponsiveContainer width="100%" height={220}><BarChart data={hist} barGap={3}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/><XAxis dataKey="mois" tick={{fontSize:11,fill:'var(--text-muted)'}}/><YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} tickFormatter={v=>(v/1000).toFixed(0)+'k'}/><Tooltip formatter={(v:number)=>formatFCFA(v)}/><Legend/><Bar dataKey="ant" name="Prevision" fill="#DBEAFE" radius={[3,3,0,0]}/><Bar dataKey="reel" name="Reel" fill="#1E40AF" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const {mois,annee,setMois,setAnnee}=useMois();
  const [onglet,setOnglet]=useState<'global'|'recap'>('global');

  // P24 : useSWR remplace le trio useState / useCallback / useEffect qui
  // faisait un fetch manuel sur la MEME URL que le useSWR d'OngletGlobal.
  // Deux requetes partaient a chaque montage et alimentaient deux etats
  // distincts. Une seule source ici, passee en prop.
  const { data: budgetData, isLoading: loadingMois } = useSWR(
    `/api/budget?annee=${annee}&mois=${mois}`,
    (url: string) => fetch(url).then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const moisCourantReel=new Date().getMonth()+1, anneeCouranteReelle=new Date().getFullYear();
  const estMoisCourant=mois===moisCourantReel&&annee===anneeCouranteReelle;

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-[var(--text)]">Tableau de bord</h1><p className="text-[var(--text-muted)] text-sm">{onglet==='global'?'Vue globale — toutes annees':'Recapitulatif annuel'}</p></div>
        {!estMoisCourant&&(<button onClick={()=>{setMois(moisCourantReel);setAnnee(anneeCouranteReelle);}} className="px-3.5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark transition-all flex items-center gap-1.5">Mois courant</button>)}
      </div>
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit">
        {([['global','Global'],['recap','Recapitulatif']] as const).map(([key,label])=>(<button key={key} onClick={()=>setOnglet(key)} className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',onglet===key?'bg-white dark:bg-dark-surface text-primary shadow-sm':'text-[var(--text-muted)] hover:text-[var(--text)]')}>{label}</button>))}
      </div>
      {onglet==='global'?(<OngletGlobal moisCourant={mois} anneeCourante={annee} budgetMois={budgetData?.budget??[]} loadingMois={loadingMois}/>):(<OngletRecap moisCourant={mois}/>)}
    </div>
  );
}
