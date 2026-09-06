'use client';

// =============================================================================
// app/(app)/suivi/page.tsx  --  etape 10 (S14)
// =============================================================================
// Ferme : P51, P52, P54, Q43 (scope). Attenue I10.
//
// P52 (critique) — le bloc « incrementer banques » calculait
//     diff = reelSaisi - localStorage['banque-saved-{annee}-{mois}-{banqueId}']
//     Vider le cache, changer d appareil ou passer en navigation privee ramene
//     l ancrage a 0 : la TOTALITE du montant est re-incrementee sur
//     banques.solde. C est le troisieme chemin d ecriture de banques.solde,
//     celui qui n ecrit pas mouvements_banque, et tres probablement l origine
//     des 435 000 non journalises de P10.
//     Correction en deux temps :
//       1. l ancrage est la valeur DB de la categorie epargne_precaution
//          correspondante au dernier chargement, conservee dans refDB. C est
//          exactement le mecanisme du bloc CompteFonds, qui lui etait correct.
//       2. la regle de chargement « garder localStorage si > 0, sinon la DB »
//          rendait le cache prioritaire sur la base. localStorage ne conserve
//          plus que la STRUCTURE (quelle banque sur quelle ligne). Les montants
//          viennent toujours de la DB.
//     Les anciennes cles banque-saved-* sont purgees au montage.
//
// P51 — la protection quickadd:done ne couvrait que l onglet courant. Un ajout
//     mobile, un decaissement ou le cron du 1er passait au travers, et
//     l auto-save a 30 s ecrasait l increment avec des valeurs absolues.
//     Le PUT n envoie desormais que les categories REELLEMENT modifiees depuis
//     le dernier chargement (dirtyCats). Une categorie non touchee n est jamais
//     reecrite : la protection ne depend plus d un evenement local.
//     Complement : rechargement au retour d onglet (visibilitychange).
//
// P54 — sauvegarder() appelait deux fois PUT /api/budget (budget puis
//     precaution), soit ~92 upserts et deux lignes d audit pour un seul geste.
//     Les deux payloads sont fusionnes en un seul appel.
//
// Q43 — cet ecran envoie scope: 'suivi'. Il n ecrit plus montantAnticipe, dont
//     il n affiche qu une lecture seule. Exception assumee : la modale KPI, qui
//     saisit explicitement les deux colonnes (voir Q60 en fin de fichier).
//
// I10 — l historique 6 mois enchainait 6 fetch sequentiels. Parallelises.
//
// LIMITE CONNUE (P59) : les incrementations de banques.solde et de
// comptes_fonds.soldeActuel restent des effets de bord pilotes par le client,
// hors transaction. Une coupure en cours de boucle laisse un etat partiel. Le
// correctif structurel est une route serveur unique qui journalise dans
// mouvements_banque ; il est hors du perimetre de ce fichier.
// =============================================================================

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Copy, Save, ChevronsDownUp, ChevronsUpDown, Plus, Trash2, Pencil,
         ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
         PieChart, Pie, Cell, Legend } from 'recharts';
import BandeauMoisAnterieur from '@/components/BandeauMoisAnterieur';
import ModalKPI from '@/components/ModalKPI';
import { useToast } from '@/components/Toast';
import { useMois, useLock } from '../contexts';
import { formatFCFA, MOIS_LABELS, ORDRE_TYPES, TYPE_LABELS,
         LABEL_PREVISION, LABEL_REEL, LABEL_ECART, LABEL_EXEC } from '@/types';
import { clsx } from 'clsx';
import EnveloppesSection from '@/components/EnveloppesSection';
import { estMoisVerrouille } from '@/lib/periode';

// ── Bloquer les caractères non numériques ─────────────────────────────────────
const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^\d$/.test(e.key)) e.preventDefault();
};

type Lignes      = Record<string, { anticipe: string; reel: string }>;
type LigneBanque = { id: string; banqueId: string; anticipe: number; reel: string };

const TYPES_OUVERTS_PAR_DEFAUT: string[] = []; // Tout plié par défaut
const MOIS_COURTS  = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const DONUT_COLORS = ['#1E40AF','#EF4444','#F59E0B','#10B981','#8B5CF6','#06B6D4','#F97316'];

// Structure des lignes banque uniquement (banqueId + ordre). Jamais de montant :
// les montants sont ceux de la base. Voir P52.
const CLE_STRUCT_BANQUE = (a: number, m: number) => `lignes-banque-${a}-${m}`;

// ── Normalisation pour matching robuste ──────────────────────────────────────
function normaliser(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

// ── Correspondance catégorie → CompteFonds par nom (Option A) ────────────────
function trouverCompteParNom(catNom: string, comptes: any[]): any | null {
  if (!catNom || !comptes.length) return null;
  const cat = normaliser(catNom);
  let match = comptes.find(c => normaliser(c.nom) === cat);
  if (match) return match;
  match = comptes.find(c => cat.includes(normaliser(c.nom)));
  if (match) return match;
  match = comptes.find(c => normaliser(c.nom).includes(cat));
  return match ?? null;
}

/**
 * P52 — purge unique des ancrages localStorage devenus obsoletes. Ils ne sont
 * plus ecrits par ce fichier ; les laisser en place ferait ressurgir le bug si
 * un ancien bundle etait servi depuis un cache navigateur.
 */
function purgerAncragesObsoletes() {
  try {
    const aSupprimer: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('banque-saved-')) aSupprimer.push(k);
    }
    aSupprimer.forEach(k => localStorage.removeItem(k));
  } catch {}
}

/**
 * Repartit les lignes banque sur les categories epargne_precaution.
 * Mapping strictement 1:1 par index. Le nombre de lignes banque ne peut pas
 * depasser le nombre de categories precaution (voir ajouterLigneBanque) : sans
 * cette contrainte, une ligne excedentaire incrementerait banques.solde sans
 * aucun ancrage en base, ce qui recreerait P52 sous une autre forme.
 */
function valeursPrecautionDepuisBanques(
  lignesBanque: LigneBanque[],
  catsPrecaution: any[],
): Record<string, string> {
  const out: Record<string, string> = {};
  catsPrecaution.forEach((cat: any, idx: number) => {
    const lb = lignesBanque[idx];
    out[cat.id] = lb ? String(parseInt(lb.reel) || 0) : '0';
  });
  return out;
}

export default function SuiviPage() {
  const { mois, annee, setMois, setAnnee } = useMois();
  const toast = useToast();
  const { isLocked } = useLock();

  const [data,         setData]         = useState<any>(null);
  const [lignes,       setLignes]       = useState<Lignes>({});
  const [banques,      setBanques]      = useState<any[]>([]);
  const [comptes,      setComptes]      = useState<any[]>([]);
  const [lignesBanque, setLignesBanque] = useState<LigneBanque[]>([]);
  const [hist,         setHist]         = useState<any[]>([]);
  const [recCatIds,    setRecCatIds]    = useState<Set<string>>(new Set());
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [copying,      setCopying]      = useState(false);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalType,    setModalType]    = useState<string>('');
  const [showTotals,   setShowTotals]   = useState(() => {
    try { return localStorage.getItem('suivi-show-totals') === 'true'; } catch { return false; }
  });

  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ORDRE_TYPES.forEach(t => { init[t] = TYPES_OUVERTS_PAR_DEFAUT.includes(t); });
    return init;
  });

  const toggleGroup       = (type: string) => setGroupsOpen(p => ({ ...p, [type]: !p[type] }));
  const expandAllGroups   = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = true;  }); setGroupsOpen(n); };
  const collapseAllGroups = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = false; }); setGroupsOpen(n); };

  const timerRef       = useRef<NodeJS.Timeout | null>(null);
  const sauvegarderRef = useRef<() => Promise<void>>(async () => {});

  // ── P51 : categories modifiees depuis le dernier chargement ───────────────
  // Seules celles-ci sont envoyees au PUT. Une categorie non touchee ne peut
  // donc plus ecraser un ajout rapide, un decaissement ou le cron du 1er.
  const dirtyCats   = useRef<Set<string>>(new Set());
  const dirtyBanque = useRef<boolean>(false);

  // ── P52 : ancrages issus de la BASE au dernier chargement ─────────────────
  // budgetParCat : montantReel en base, par categorie.
  // banqueParLigne : valeur DB attribuee a chaque ligne banque (index -> montant).
  const refDB = useRef<{
    budgetParCat: Record<string, number>;
    banqueParLigne: number[];
  }>({ budgetParCat: {}, banqueParLigne: [] });

  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();

  const toggleTotals = () => {
    const next = !showTotals;
    setShowTotals(next);
    try { localStorage.setItem('suivi-show-totals', String(next)); } catch {}
  };

  useEffect(() => { purgerAncragesObsoletes(); }, []);

  // ── Chargement ──────────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [resBudget, resBanques, resComptes] = await Promise.all([
        fetch(`/api/budget?annee=${annee}&mois=${mois}`),
        fetch('/api/banques'),
        fetch('/api/comptes'),
      ]);
      if (!resBudget.ok) { setLoading(false); return; }
      const d = await resBudget.json();
      setData(d);

      // ── Ancrage DB par categorie ───────────────────────────────────────
      const budgetParCat: Record<string, number> = {};
      for (const b of (d.budget ?? [])) {
        budgetParCat[b.categorieId] = Number(b.montantReel ?? 0);
      }

      const init: Lignes = {};
      for (const cat of (d.categories ?? [])) {
        const b = (d.budget ?? []).find((x: any) => x.categorieId === cat.id);
        init[cat.id] = {
          anticipe: (b?.montantAnticipe != null && b.montantAnticipe !== 0)
            ? String(b.montantAnticipe) : '',
          reel: (b?.montantReel != null && b.montantReel !== 0)
            ? String(b.montantReel) : '',
        };
      }

      if (resComptes.ok) {
        const dc = await resComptes.json();
        setComptes(dc.comptes ?? []);
      }

      let bqs: any[] = [];
      let lignesBanqueDB: LigneBanque[] = [];

      if (resBanques.ok) {
        const db = await resBanques.json();
        bqs = db.banques ?? [];
        setBanques(bqs);

        const catsPrecaution = (d.categories ?? [])
          .filter((c: any) => c.type === 'epargne_precaution');

        // ── Structure des lignes depuis localStorage, montants depuis la DB ──
        // P52 : le cache ne porte plus que banqueId. Les anciennes entrees
        // contiennent encore un `reel` : il est volontairement ignore.
        let structure: Array<{ id: string; banqueId: string }> = [];
        try {
          const sv = localStorage.getItem(CLE_STRUCT_BANQUE(annee, mois));
          if (sv) {
            const parsed = JSON.parse(sv);
            if (Array.isArray(parsed)) {
              structure = parsed
                .filter((x: any) => x && typeof x.banqueId === 'string')
                .map((x: any, i: number) => ({
                  id: typeof x.id === 'string' ? x.id : `lb-${i + 1}`,
                  banqueId: x.banqueId,
                }));
            }
          }
        } catch {}

        if (structure.length === 0) {
          structure = catsPrecaution.map((_: any, idx: number) => ({
            id: `lb-${idx + 1}`,
            banqueId: bqs[idx]?.id ?? '',
          }));
        }

        // Jamais plus de lignes que de categories precaution (voir en-tete).
        if (structure.length > catsPrecaution.length) {
          structure = structure.slice(0, Math.max(catsPrecaution.length, 1));
        }
        if (structure.length === 0) {
          structure = [{ id: 'lb-1', banqueId: bqs[0]?.id ?? '' }];
        }

        lignesBanqueDB = structure.map((s, idx) => {
          const catPrec = catsPrecaution[idx];
          const reelDB  = catPrec ? (budgetParCat[catPrec.id] ?? 0) : 0;
          const bBudget = catPrec
            ? (d.budget ?? []).find((x: any) => x.categorieId === catPrec.id)
            : null;
          return {
            id:       s.id,
            banqueId: s.banqueId,
            anticipe: Number(bBudget?.montantAnticipe ?? 0),
            reel:     reelDB !== 0 ? String(reelDB) : '',
          };
        });

        setLignesBanque(lignesBanqueDB);

        // lignes[catPrec] reflete la valeur DB, pas une valeur de cache.
        catsPrecaution.forEach((cat: any, idx: number) => {
          const lb = lignesBanqueDB[idx];
          init[cat.id] = {
            anticipe: init[cat.id]?.anticipe ?? '',
            reel:     lb ? (lb.reel || '') : '',
          };
        });
      }

      setLignes(init);

      refDB.current = {
        budgetParCat,
        banqueParLigne: lignesBanqueDB.map(lb => parseInt(lb.reel) || 0),
      };
      dirtyCats.current = new Set();
      dirtyBanque.current = false;

      // ── I10 : historique 6 mois en parallele ─────────────────────────────
      const fenetre: Array<{ m: number; a: number }> = [];
      for (let i = 5; i >= 0; i--) {
        let m = mois - i, a = annee;
        if (m <= 0) { m += 12; a--; }
        fenetre.push({ m, a });
      }
      const histData = await Promise.all(fenetre.map(async ({ m, a }) => {
        try {
          const hr = await fetch(`/api/budget?annee=${a}&mois=${m}`);
          if (!hr.ok) return { mois: MOIS_COURTS[m], prev: 0, reel: 0 };
          const hd = await hr.json();
          const dep = (hd.budget ?? []).filter((b: any) => b.categorie?.type?.startsWith('depense'));
          return {
            mois: MOIS_COURTS[m],
            prev: dep.reduce((s: number, b: any) => s + (b.montantAnticipe ?? 0), 0),
            reel: dep.reduce((s: number, b: any) => s + (b.montantReel ?? 0), 0),
          };
        } catch {
          return { mois: MOIS_COURTS[m], prev: 0, reel: 0 };
        }
      }));
      setHist(histData);
    } catch (e) {
      console.error('charger:', e);
    } finally {
      setLoading(false);
    }
  }, [mois, annee]);

  useEffect(() => { charger(); }, [charger]);

  // Quick Add dans le meme onglet.
  useEffect(() => {
    const onQuickAdd = () => { charger(); };
    window.addEventListener('quickadd:done', onQuickAdd);
    return () => window.removeEventListener('quickadd:done', onQuickAdd);
  }, [charger]);

  // ── P51 : resynchronisation au retour d onglet ────────────────────────────
  // Complete quickadd:done, qui ne couvre que l onglet courant. On ne recharge
  // pas si des saisies sont en attente, pour ne pas les perdre.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (dirtyCats.current.size > 0 || dirtyBanque.current) return;
      charger();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [charger]);

  useEffect(() => {
    const periode = `${annee}-${String(mois).padStart(2, '0')}`;
    fetch(`/api/recurrentes?periode=${periode}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setRecCatIds(new Set<string>(d?.executionsCategorieIds ?? [])))
      .catch(() => {});
  }, [mois, annee]);

  // ── P52 : seule la STRUCTURE est persistee, jamais les montants ───────────
  useEffect(() => {
    if (lignesBanque.length === 0) return;
    try {
      localStorage.setItem(
        CLE_STRUCT_BANQUE(annee, mois),
        JSON.stringify(lignesBanque.map(l => ({ id: l.id, banqueId: l.banqueId }))),
      );
    } catch {}
  }, [lignesBanque, annee, mois]);

  const scheduleSave = () => {
    if (isLocked) return;
    if (estMoisVerrouille(annee, mois)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { sauvegarderRef.current(); }, 30_000);
  };

  const handleChange = (catId: string, field: 'anticipe'|'reel', val: string) => {
    if (isLocked) return;
    dirtyCats.current.add(catId);
    setLignes(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: val } }));
    scheduleSave();
    setSaved(false);
  };

  const cats           = data?.categories ?? [];
  const catsPrecaution = cats.filter((c: any) => c.type === 'epargne_precaution');

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const sauvegarder = async () => {
    if (isLocked) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    if (!data?.anneeId && !annee) {
      toast.error('Aucune annee selectionnee — rechargez la page');
      return;
    }

    // ── P54 : un seul payload, une seule requete ────────────────────────────
    // ── P51 : uniquement les categories reellement modifiees ────────────────
    const payload: Record<string, { reel: string }> = {};
    for (const catId of Array.from(dirtyCats.current)) {
      payload[catId] = { reel: String(parseInt(lignes[catId]?.reel ?? '0') || 0) };
    }

    const valeursPrec = valeursPrecautionDepuisBanques(lignesBanque, catsPrecaution);
    if (dirtyBanque.current) {
      for (const [catId, valeur] of Object.entries(valeursPrec)) {
        payload[catId] = { reel: valeur };
      }
    }

    if (Object.keys(payload).length === 0) {
      toast.info('Aucune modification a enregistrer');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    setSaving(true);
    (window as any).__setSaveStatus?.('saving');

    const res = await fetch('/api/budget', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(data?.anneeId ? { anneeId: data.anneeId } : {}),
        annee,
        mois,
        scope: 'suivi',      // Q43 — cet ecran n ecrit jamais montantAnticipe
        lignes: payload,
      }),
    });

    if (!res.ok) {
      setSaving(false);
      try {
        const errBody = await res.clone().json();
        toast.error(`Erreur sauvegarde : ${errBody.error ?? res.status}`);
      } catch {
        toast.error(`Erreur sauvegarde HTTP ${res.status}`);
      }
      (window as any).__setSaveStatus?.('error');
      return;
    }

    // ── Effets de bord sur les soldes ───────────────────────────────────────
    // Tous les deltas sont calcules contre un ancrage BASE (refDB), jamais
    // contre localStorage. Voir P52 et la limite connue P59 en en-tete.
    const ancres = refDB.current;

    // 1. epargne_precaution -> banques
    if (dirtyBanque.current) {
      const vus = new Set<string>();
      for (let idx = 0; idx < lignesBanque.length; idx++) {
        const lb = lignesBanque[idx];
        if (!lb.banqueId) continue;
        if (vus.has(lb.banqueId)) {
          toast.error(`Banque en double sur deux lignes — solde non mis a jour pour l une d elles`);
          continue;
        }
        vus.add(lb.banqueId);

        const nouveau = parseInt(lb.reel) || 0;
        const ancien  = ancres.banqueParLigne[idx] ?? 0;
        const delta   = nouveau - ancien;
        if (delta === 0) continue;

        await fetch(`/api/banques?id=${lb.banqueId}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:  delta > 0 ? 'increment' : 'decrement',
            montant: Math.abs(delta),
            motif:   `Suivi ${MOIS_LABELS[mois]} ${annee} — epargne de precaution`,
          }),
        });
      }
    }

    // 2. epargne_autre -> CompteFonds
    for (const cat of cats.filter((c: any) => c.type === 'epargne_autre')) {
      if (!dirtyCats.current.has(cat.id)) continue;
      const nouveau = parseInt(lignes[cat.id]?.reel ?? '0') || 0;
      const ancien  = ancres.budgetParCat[cat.id] ?? 0;
      const delta   = nouveau - ancien;
      if (delta === 0) continue;

      const compte = trouverCompteParNom(cat.nom, comptes);
      if (!compte) continue;

      await fetch(`/api/comptes?id=${compte.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:  delta > 0 ? 'increment' : 'decrement',
          montant: Math.abs(delta),
        }),
      });
    }

    // 3. epargne_investissement liee a une banque -> banques
    for (const cat of cats.filter((c: any) => c.type === 'epargne_investissement' && c.banqueId)) {
      if (!dirtyCats.current.has(cat.id)) continue;
      const nouveau = parseInt(lignes[cat.id]?.reel ?? '0') || 0;
      const ancien  = ancres.budgetParCat[cat.id] ?? 0;
      const delta   = nouveau - ancien;
      if (delta === 0) continue;

      await fetch(`/api/banques?id=${cat.banqueId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:  delta > 0 ? 'increment' : 'decrement',
          montant: Math.abs(delta),
          motif:   `Suivi ${MOIS_LABELS[mois]} ${annee} — ${cat.nom}`,
        }),
      });
    }

    setSaving(false);
    setSaved(true);
    toast.success('Suivi mensuel sauvegarde');
    (window as any).__setSaveStatus?.('saved');

    // La base est la source de verite : on relit au lieu de rafistoler l etat
    // local. charger() reinitialise aussi refDB et les marqueurs dirty.
    await charger();

    setTimeout(() => { setSaved(false); (window as any).__setSaveStatus?.('idle'); }, 3000);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sauvegarderRef.current = sauvegarder; });

  const copierMoisPrecedent = async () => {
    if (isLocked) return;
    const pm = mois === 1 ? 12 : mois - 1;
    const pa = mois === 1 ? annee - 1 : annee;
    if (!window.confirm(`Copier les previsions de ${MOIS_LABELS[pm]} ${pa} vers ce mois ?\nCela remplacera les previsions actuelles.`)) return;
    setCopying(true);
    const res = await fetch(`/api/budget?annee=${pa}&mois=${pm}`);
    if (res.ok) {
      const prev = await res.json();
      // Q43 : cet ecran n ecrit pas le previsionnel. La copie ne fait
      // qu alimenter l affichage ; elle est enregistree depuis l ecran Budget.
      setLignes(prevL => {
        const newL = { ...prevL };
        for (const b of (prev.budget ?? [])) {
          if (newL[b.categorieId] !== undefined) {
            newL[b.categorieId] = { ...newL[b.categorieId], anticipe: String(b.montantAnticipe) };
          }
        }
        return newL;
      });
      toast.info(`Previsions de ${MOIS_LABELS[pm]} ${pa} affichees — enregistrez-les depuis l ecran Budget`);
    } else {
      toast.error('Erreur lors de la copie');
    }
    setCopying(false);
  };

  // Q60 — la modale KPI saisit explicitement prevision ET reel. C est la seule
  // ecriture 'les_deux' de cet ecran, et elle est assumee : le risque de Q43
  // etait le renvoi silencieux d une valeur perimee, pas une saisie volontaire.
  // A revoir quand ModalKPI sera passe en revue.
  const handleModalSave = async (vals: Record<string, { prevision: string; reel: string }>) => {
    if (!data?.anneeId && !annee) return;
    const payload: Record<string, { anticipe: string; reel: string }> = {};
    for (const [catId, val] of Object.entries(vals)) {
      payload[catId] = { anticipe: val.prevision, reel: val.reel };
      dirtyCats.current.delete(catId); // ecrit ici, plus besoin de le renvoyer
    }
    setLignes(prev => {
      const next = { ...prev };
      for (const [catId, val] of Object.entries(vals)) {
        next[catId] = { anticipe: val.prevision, reel: val.reel };
      }
      return next;
    });
    const res = await fetch('/api/budget', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(data?.anneeId ? { anneeId: data.anneeId } : {}),
        annee, mois, scope: 'les_deux', lignes: payload,
      }),
    });
    if (res.ok) { toast.success('Donnees mises a jour'); charger(); }
    else { toast.error('Erreur lors de la mise a jour'); }
  };

  // ── Lignes banque ─────────────────────────────────────────────────────────
  const ajouterLigneBanque = () => {
    if (isLocked) return;
    if (lignesBanque.length >= catsPrecaution.length) {
      toast.error(
        `Chaque ligne banque doit correspondre a une categorie d epargne de precaution `
        + `(${catsPrecaution.length} disponible(s)). Creez d abord la categorie.`,
      );
      return;
    }
    dirtyBanque.current = true;
    setLignesBanque(prev => [
      ...prev,
      { id: `lb-${Date.now()}`, banqueId: banques[0]?.id ?? '', anticipe: 0, reel: '' },
    ]);
  };

  const supprimerLigneBanque = (id: string) => {
    if (isLocked) return;
    dirtyBanque.current = true;
    setLignesBanque(prev => prev.filter(l => l.id !== id));
  };

  const updateLigneBanque = (id: string, field: keyof LigneBanque, val: any) => {
    if (isLocked) return;
    dirtyBanque.current = true;

    const updated = lignesBanque.map(l => (l.id === id ? { ...l, [field]: val } : l));
    setLignesBanque(updated);

    if (field === 'reel') {
      const valeurs = valeursPrecautionDepuisBanques(updated, catsPrecaution);
      setLignes(prev => {
        const synced = { ...prev };
        for (const [catId, valeur] of Object.entries(valeurs)) {
          synced[catId] = { anticipe: prev[catId]?.anticipe ?? '', reel: valeur };
        }
        return synced;
      });
      scheduleSave();
      setSaved(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  // ── Totaux ──────────────────────────────────────────────────────────────
  const totalAnticipePrecaution = catsPrecaution.reduce((s: number, c: any) => {
    const b = data?.budget?.find((b: any) => b.categorieId === c.id);
    return s + (b?.montantAnticipe ?? 0);
  }, 0);
  const totalReelBanques = lignesBanque.reduce((s, l) => s + (parseInt(l.reel) || 0), 0);

  const revAnt  = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const revReel = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  const epAnt  = cats.filter((c: any) => c.type?.startsWith('epargne')).reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const epReel = cats.filter((c: any) => c.type?.startsWith('epargne')).reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  const depAnt  = cats.filter((c: any) => c.type?.startsWith('depense') || c.type === 'remboursement_dette').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const depReel = cats.filter((c: any) => c.type?.startsWith('depense') || c.type === 'remboursement_dette').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  const soldeAnt  = revAnt  - epAnt  - depAnt;
  const soldeReel = revReel - epReel - depReel;
  const tauxExec  = revAnt  > 0 ? (revReel / revAnt)  * 100 : 0;
  const tauxEp    = revReel > 0 ? (epReel  / revReel) * 100 : 0;

  const grouped = ORDRE_TYPES.map(type => ({
    type, items: cats.filter((c: any) => c.type === type),
  })).filter(g => g.items.length > 0);

  const modalCats = cats.filter((c: any) => c.type === modalType);

  const donutData = Object.entries(
    cats.filter((c: any) => c.type?.startsWith('depense') && (parseInt(lignes[c.id]?.reel) || 0) > 0)
        .reduce((acc: any, c: any) => { acc[c.nom] = (acc[c.nom] ?? 0) + (parseInt(lignes[c.id]?.reel) || 0); return acc; }, {})
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5 animate-fadeIn">

      <EnveloppesSection mois={mois} annee={annee} readOnly />
      <BandeauMoisAnterieur mois={mois} annee={annee}
        onMoisCourant={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }} />

      <ModalKPI isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleModalSave}
        titre={TYPE_LABELS[modalType as keyof typeof TYPE_LABELS] ?? ''}
        categories={modalCats} lignes={lignes} mode="both" />

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Suivi mensuel</h1>
          <p className="text-[var(--text-muted)] text-sm">{MOIS_LABELS[mois]} {annee}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={collapseAllGroups}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={expandAllGroups}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={toggleTotals}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            {showTotals ? '🙈 Masquer totaux' : '👁️ Afficher totaux'}
          </button>
          <button onClick={copierMoisPrecedent} disabled={copying || isLocked}
            className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Copy size={14} />{copying ? 'Copie...' : 'Mois précédent'}
          </button>
          <button onClick={sauvegarder} disabled={saving || isLocked}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Save size={14} />{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus',  val: revReel,   ant: revAnt,   type: 'revenu',       cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label: 'Épargne',  val: epReel,    ant: epAnt,    type: 'epargne_precaution', cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label: 'Dépenses', val: depReel,   ant: depAnt,   type: 'depense_fixe', cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label: 'Solde',    val: soldeReel, ant: soldeAnt, type: '',
            cls: soldeReel >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 flex flex-col gap-1 transition-colors', k.cls)}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              {k.type && (
                <button onClick={() => { setModalType(k.type); setModalOpen(true); }}
                  className="p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors flex-shrink-0 -mt-0.5 -mr-0.5" title="Modifier">
                  <Pencil size={11} className="opacity-60" />
                </button>
              )}
            </div>
            <p className="text-lg font-bold">{formatFCFA(k.val)}</p>
            <p className="text-xs opacity-55">Prévision : {formatFCFA(k.ant)}</p>
          </div>
        ))}
      </div>

      {/* ── KPIs analytiques ── */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <span className="text-primary text-lg">📊</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d&apos;exécution</p>
            <p className="text-xl font-bold text-primary">{tauxExec.toFixed(1)} %</p>
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
            <span className="text-lg">🐷</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d&apos;épargne</p>
            <p className={clsx('text-xl font-bold', tauxEp >= 30 ? 'text-green-600' : tauxEp >= 15 ? 'text-amber-500' : 'text-red-500')}>
              {tauxEp.toFixed(1)} %
            </p>
            <p className="text-xs text-[var(--text-muted)]">Objectif : 30 %</p>
          </div>
        </div>
      </div>

      {/* ── Tableau ── */}
      <div className="max-w-5xl mx-auto w-full">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: '140px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '70px'  }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                  <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase tracking-wide">Catégorie</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_PREVISION}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_REEL}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_ECART}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_EXEC}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ type, items }) => {
                  const isRevenu       = type === 'revenu';
                  const isEpPrecaution = type === 'epargne_precaution';
                  const isEpAutre      = type === 'epargne_autre';
                  const isOpen         = groupsOpen[type] === true;

                  let gAnt: number, gReel: number;
                  if (isEpPrecaution) {
                    gAnt  = totalAnticipePrecaution;
                    gReel = totalReelBanques;
                  } else {
                    gAnt  = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
                    gReel = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);
                  }
                  const gEcar = gReel - gAnt;
                  const gPct  = gAnt > 0 ? (gReel / gAnt) * 100 : 0;

                  const gEcarColor = isRevenu
                    ? gEcar > 0 ? 'text-green-500' : gEcar < 0 ? 'text-red-500' : 'text-[var(--text-muted)]'
                    : gEcar > 0 ? 'text-red-500'  : gEcar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]';
                  const gTauxColor = gPct > 110 ? 'text-red-500' : gPct > 100 ? 'text-orange-500' : gPct >= 80 ? 'text-amber-500' : 'text-green-500';

                  return (
                    <Fragment key={type}>
                      <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)] cursor-pointer hover:bg-slate-100 dark:hover:bg-dark-card/80 transition-colors"
                          onClick={() => toggleGroup(type)}>
                        <td className="px-4 py-2.5 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                            {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gAnt > 0 ? formatFCFA(gAnt) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gReel > 0 ? formatFCFA(gReel) : '—'}</td>
                        <td className={clsx('px-4 py-2.5 text-right text-xs font-bold', gEcarColor)}>
                          {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {gAnt > 0 ? <span className={clsx('text-xs font-bold', gTauxColor)}>{gPct.toFixed(0)}%</span> : <span className="text-xs text-[var(--text-muted)]">—</span>}
                        </td>
                      </tr>

                      {isOpen && (
                        <>
                          {isEpPrecaution ? (
                            <>
                              {lignesBanque.map((lb, idx) => (
                                <tr key={lb.id} className="border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors">
                                  <td className="px-4 py-2.5 pl-10">
                                    <div className="flex items-center gap-2">
                                      <select value={lb.banqueId} disabled={isLocked}
                                        onChange={e => updateLigneBanque(lb.id, 'banqueId', e.target.value)}
                                        className="border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none w-full max-w-[180px]">
                                        <option value="">— Choisir banque —</option>
                                        {banques.map((b: any) => <option key={b.id} value={b.id}>{b.nomBanque}</option>)}
                                      </select>
                                      {catsPrecaution[idx] && (
                                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-dark-card text-[var(--text-muted)] flex-shrink-0 truncate max-w-[140px]"
                                          title={`Rapprochee de : ${catsPrecaution[idx].nom}`}>
                                          → {catsPrecaution[idx].nom}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-sm text-[var(--text-muted)]">
                                    {lb.anticipe > 0 ? formatFCFA(lb.anticipe) : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <input type="number" value={lb.reel} disabled={isLocked}
                                      onChange={e => updateLigneBanque(lb.id, 'reel', e.target.value)}
                                      onKeyDown={onlyNumbers}
                                      placeholder="0"
                                      className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-60" />
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-sm text-[var(--text-muted)]">—</td>
                                  <td className="px-4 py-2.5 text-right">
                                    <button onClick={() => supprimerLigneBanque(lb.id)} disabled={isLocked}
                                      className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40">
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-[var(--border)]">
                                <td colSpan={5} className="px-4 py-2 pl-10">
                                  <button onClick={ajouterLigneBanque} disabled={isLocked}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark font-medium transition-colors disabled:opacity-40">
                                    <Plus size={13} />Ajouter une banque
                                  </button>
                                  <span className="ml-3 text-[11px] text-[var(--text-muted)]">
                                    {lignesBanque.length} / {catsPrecaution.length} categorie(s) d&apos;epargne de precaution
                                  </span>
                                </td>
                              </tr>
                              {showTotals && (
                                <tr className="bg-blue-50/40 dark:bg-blue-900/10 border-t border-[var(--border)]">
                                  <td className="px-4 py-2 pl-10 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalAnticipePrecaution)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalReelBanques)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-green-500">
                                    {(totalReelBanques - totalAnticipePrecaution) !== 0
                                      ? ((totalReelBanques - totalAnticipePrecaution) > 0 ? '+' : '') + formatFCFA(totalReelBanques - totalAnticipePrecaution)
                                      : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">
                                    {totalAnticipePrecaution > 0 ? ((totalReelBanques / totalAnticipePrecaution) * 100).toFixed(0) + '%' : '—'}
                                  </td>
                                </tr>
                              )}
                            </>
                          ) : (
                            <>
                              {items.map((cat: any) => {
                                const ant  = parseInt(lignes[cat.id]?.anticipe) || 0;
                                const reel = parseInt(lignes[cat.id]?.reel)     || 0;
                                const ecar = reel - ant;
                                const pct  = ant > 0 ? (reel / ant) * 100 : 0;
                                const over = !isRevenu && ant > 0 && reel > ant;
                                const fondLie = isEpAutre ? trouverCompteParNom(cat.nom, comptes) : null;
                                const ecarColor = isRevenu
                                  ? reel > ant ? 'text-green-500' : reel < ant ? 'text-red-500' : 'text-[var(--text-muted)]'
                                  : ecar > 0   ? 'text-red-500'  : ecar < 0   ? 'text-green-500' : 'text-[var(--text-muted)]';
                                return (
                                  <tr key={cat.id}
                                    className={clsx('border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors',
                                      over && 'bg-red-50/30 dark:bg-red-900/10')}>
                                    <td className="px-4 py-2.5 pl-10 text-[var(--text)]">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {over && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                                        <span className="truncate">{cat.nom}</span>
                                        {recCatIds.has(cat.id) && (
                                          <span title="Alimentée par une récurrente ce mois"
                                            className="text-xs px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 font-medium flex-shrink-0">
                                            🔄 auto
                                          </span>
                                        )}
                                        {fondLie && (
                                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium flex-shrink-0">
                                            → {fondLie.nom}
                                          </span>
                                        )}
                                        {isEpAutre && !fondLie && (
                                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-dark-card text-[var(--text-muted)] flex-shrink-0">
                                            non lié
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      {/* Prévision = lecture seule — modifiable dans Budget prévisionnel */}
                                      <div className="w-full text-right px-2 py-1.5 text-sm text-[var(--text-muted)] select-none">
                                        {ant > 0 ? formatFCFA(ant) : <span className="opacity-30">—</span>}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="number" value={lignes[cat.id]?.reel ?? ''} disabled={isLocked}
                                        onChange={e => handleChange(cat.id, 'reel', e.target.value)} onKeyDown={onlyNumbers} placeholder="0"
                                        className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none disabled:opacity-60" />
                                    </td>
                                    <td className={clsx('px-4 py-2.5 text-right text-sm font-medium', ecarColor)}>
                                      {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-sm">
                                      {ant > 0 ? (
                                        <span className={clsx('font-semibold',
                                          pct > 110 ? 'text-red-500' : pct > 100 ? 'text-orange-500' : pct >= 80 ? 'text-amber-500' : 'text-green-500')}>
                                          {pct.toFixed(0)}%
                                        </span>
                                      ) : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                              {showTotals && (
                                <tr className="bg-slate-50/70 dark:bg-dark-card/70 border-t border-[var(--border)]">
                                  <td className="px-4 py-2 pl-10 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                                  <td className={clsx('px-4 py-2 text-right text-xs font-bold', gEcarColor)}>
                                    {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs">
                                    {gAnt > 0 ? <span className={clsx('font-bold', gTauxColor)}>{gPct.toFixed(0)}%</span> : '—'}
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totaux globaux */}
          <div className="border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10">
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
              <span className="font-semibold text-[var(--text)] text-sm">Total sorties (épargne + dépenses)</span>
              <div className="flex gap-8">
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(epAnt + depAnt)}</span>
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(epReel + depReel)}</span>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="font-bold text-[var(--text)]">Solde disponible</span>
              <div className="flex gap-8">
                <span className={clsx('font-bold', soldeAnt >= 0 ? 'text-green-600' : 'text-red-500')}>{formatFCFA(soldeAnt)}</span>
                <span className={clsx('font-bold text-lg', soldeReel >= 0 ? 'text-green-600' : 'text-red-500')}>{formatFCFA(soldeReel)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Graphiques ── */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">📊 Dépenses — 6 derniers mois</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hist} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mois" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000).toFixed(0)+'k'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey="prev" name="Prévision" fill="#DBEAFE" radius={[3,3,0,0]} />
              <Bar dataKey="reel" name="Réel"      fill="#1E40AF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">🥧 Répartition dépenses ce mois</h3>
          {donutData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {donutData.map((_: any, i: number) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatFCFA(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
                {donutData
                  .map((item: any, origIdx: number) => ({ ...item, origIdx }))
                  .sort((a: any, b: any) => (b.value as number) - (a.value as number))
                  .map((item: any) => {
                    const total = donutData.reduce((s: number, d: any) => s + (d.value as number), 0);
                    const pct = total > 0 ? ((item.value as number) / total * 100).toFixed(1) : '0';
                    return (
                      <div key={item.origIdx} className="flex items-center gap-1.5 text-xs">
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: DONUT_COLORS[item.origIdx % DONUT_COLORS.length] }} />
                        <span className="flex-1 truncate text-[var(--text)]">{item.name}</span>
                        <span className="text-[var(--text-muted)] w-9 text-right flex-shrink-0">{pct}%</span>
                        <span className="font-semibold text-[var(--text)] w-24 text-right flex-shrink-0">
                          {formatFCFA(item.value as number)}
                        </span>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)] flex justify-between text-xs font-bold">
                <span className="text-[var(--text-muted)]">Total</span>
                <span className="text-[var(--text)]">{formatFCFA(donutData.reduce((s: number, d: any) => s + (d.value as number), 0))}</span>
              </div>
            </>
          ) : (
            <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">Aucune dépense ce mois</div>
          )}
        </div>
      </div>
    </div>
  );
}
