'use client';

// =============================================================================
// app/(app)/budget/page.tsx  --  etape 7 (S15)
// =============================================================================
// Ferme : P29, P60, P61, P62, P63, P64, P65, P67, Q43/Q61, Q65.
// Attenue : Q67 (concurrence), P69 (clamp silencieux cote serveur).
// Apporte : I11, I12, I14, I15, I17.
//
// P29 (critique apres ④) — refParType faisait
//     SUM(categories[].tauxReference) sur le type. Depuis ④ le GET recopie le
//     taux du TYPE sur chaque categorie du type (bloc de compatibilite Q40) :
//     la somme n est plus approximativement fausse, elle est fausse d un
//     facteur exactement egal au nombre de categories du type. Sur
//     depense_fixe (13 categories) 22,78 % devenait 296,14 %.
//     L allocation vient desormais de parametres.parType[type].montant,
//     calcule par lib/reference et par lui seul (I1). Ce fichier ne fait plus
//     AUCUN calcul d allocation.
//
// P60 — sauvegarder() et copierVersProchainMois() ignoraient res.ok. Un 409,
//     un 422 ou un 500 affichait « Sauvegarde ✓ ». Toutes les reponses sont
//     desormais lues, et l echec est signale par un toast explicite.
//
// P61 — appliquerReference() repartissait refTotal / nbCategories COTE CLIENT.
//     C etait une troisieme source de calcul d allocation, exactement le motif
//     de P46. La fonction recopie desormais categories[].montantReference,
//     valeur produite par ⑤ et maintenue par ④. Plus aucune division ici.
//
// P62 — le verrou mois passe etait purement client : evalue sur l horloge du
//     poste, et annulable par setLocked(false). La regle vit maintenant dans
//     lib/periode.ts (I16), le serveur l applique (423), et cet ecran ne fait
//     qu anticiper sa reponse. Le bouton « Deverrouiller » n annule plus rien
//     localement : il ARME une derogation, envoyee au serveur et tracee dans
//     logAudit avec le motif MOTIF_DEROGATION. Meme regime que les DELETE
//     financiers : la correction reste possible, elle laisse une trace.
//
// P63 — le cache sessionStorage 'gestbudget-params-cache-v2' figeait la
//     reponse de /api/parametres 5 minutes. La forme de cette reponse change
//     avec ④ (ajout de parType et version) : un cache v2 encore chaud aurait
//     donne parType === undefined, donc tous les indicateurs a zero, sans
//     aucune erreur. Le cache est supprime (I11) et les anciennes cles sont
//     purgees au montage. La revalidation passe par l ETag pose par ④, qui
//     renvoie un 304 d environ 150 octets et n a pas de fenetre de peremption.
//
// P64 — charger() n avait pas d AbortController. En navigation rapide entre
//     mois, la derniere reponse ARRIVEE ecrasait, pas la derniere DEMANDEE :
//     les montants de mars pouvaient s afficher sous l en-tete d avril. Chaque
//     chargement annule le precedent.
//
// P65 / I14 — parseInt sans radix sur un input type=number, qui laisse passer
//     `-50000` et `1e3` (parseInt('1e3') === 1). L input est passe en
//     type=text + inputMode=numeric, la saisie est filtree aux chiffres, et
//     toEntierPositif() est la seule conversion du fichier. Cote serveur
//     versEntier() clampe deja a 0, mais SILENCIEUSEMENT (P69) : l utilisateur
//     voyait « Sauvegarde ✓ » sur une valeur qu il n avait pas saisie.
//
// P67 — importerRecurrentes() additionnait encaissements et decaissements dans
//     un total unique annonce « X FCFA/mois ». Sur un utilisateur ayant declare
//     son salaire en recurrente, le chiffre affiche etait un net qui ne voulait
//     rien dire. Les deux flux sont desormais separes, et la confirmation
//     montre le detail par categorie (ancien -> nouveau) au lieu d un agregat
//     qui masquait ce qui allait etre ecrase.
//     Le modele Recurrente ne porte aucune frequence : toute recurrente est
//     implicitement mensuelle, la somme est donc juste par construction. Voir
//     Q66 pour l absence de fenetre de validite (dateDebut / dateFin).
//
// Q43 / Q61 — cet ecran envoie scope: 'previsionnel' et la cle `anticipe`
//     SEULE. Il n a plus aucune raison de relire montantReel depuis
//     data.budget, ce qui etait le motif d origine de Q43. Depuis ⑩b v3 la
//     presence de `reel` avec ce scope est refusee en 422 : l erreur est
//     bruyante, plus silencieuse.
//
// Q65 — cet ecran est en LECTURE SEULE sur /api/parametres. Aucun PUT, donc
//     aucun jeton de concurrence I3 a manipuler ici.
//
// Q67 (attenue, non ferme) — il n existe pas de concurrence optimiste sur PUT
//     /api/budget. La version precedente renvoyait systematiquement les 46
//     lignes : deux onglets sur le meme mois, le dernier ecrasait tout. Le
//     mecanisme dirtyCats de ⑩c est repris ici : seules les categories
//     REELLEMENT modifiees depuis le dernier chargement sont envoyees. Une
//     categorie non touchee n est jamais reecrite.
//
// I15 — l invariant R3-a est verifiable a l ecran sans requete supplementaire :
//     parametres.parType donne l allocation par type, parametres.categories
//     donne le montantReference par categorie. Si la somme ne tombe pas juste,
//     une ecriture a contourne lib/reference. Le bandeau le dit.
//
// I17 — montantReference etant desormais fiable PAR CATEGORIE (et plus
//     seulement par type), le tableau affiche une colonne « Ref. » ligne a
//     ligne. C est le benefice concret de ⑤ : la comparaison passe de 7 lignes
//     agregees a 46 lignes, avec les donnees deja en main.
// =============================================================================

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Save, Copy, ChevronsDownUp, ChevronsUpDown,
  Sparkles, Lock, LockOpen, AlertTriangle, ShieldAlert,
  TrendingUp, BarChart2, History, Info, RefreshCw,
} from 'lucide-react';
import CollapsibleGroup, { useCollapseAll } from '@/components/CollapsibleGroup';
import BandeauMoisAnterieur from '@/components/BandeauMoisAnterieur';
import EnveloppesSection from '@/components/EnveloppesSection';
import { useToast } from '@/components/Toast';
import { formatFCFA, ORDRE_TYPES, TYPE_LABELS, LABEL_PREVISION } from '@/types';
import { clsx } from 'clsx';
import { useMois, useLock } from '../contexts';
import { estMoisVerrouille, joursAvantVerrou } from '@/lib/periode';

/* ────────────────────────────────────────────────────────────── */

const MOIS_NOMS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                   'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MOIS_COURTS = ['', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
                     'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/** Ecart tolere sur l invariant R3-a : arrondi entier, jamais plus (I15). */
const TOLERANCE_INVARIANT = 1;

/** Nombre de lignes de detail affichees dans la confirmation d import (P67). */
const MAX_LIGNES_CONFIRMATION = 12;

// ── I14 / P65 : unique conversion du fichier ────────────────────
// parseInt sans radix sur '1e3' rend 1 ; sur '-50000' il rend -50000, que le
// serveur clampe ensuite a 0 sans le dire (P69). Tout passe par ici.
function toEntierPositif(v: string | number | null | undefined): number {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  }
  const s = String(v ?? '').trim();
  if (s === '') return 0;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/** Ne conserve que les chiffres. Applique a la frappe, pas a la sauvegarde. */
function filtrerChiffres(v: string): string {
  return v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/**
 * P63 — purge des caches de parametres devenus incompatibles avec ④. Ils ne
 * sont plus ecrits par ce fichier ; les laisser ferait ressurgir le bug si un
 * ancien bundle etait servi depuis un cache navigateur.
 */
function purgerCachesObsoletes() {
  try {
    const aSupprimer: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('gestbudget-params-cache')) aSupprimer.push(k);
    }
    aSupprimer.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

// ── Mini barre de progression ───────────────────────────────────
function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
      <div className={clsx('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */
export default function BudgetPage() {
  const { mois, annee, setMois, setAnnee } = useMois();
  const { isLocked: globalLocked } = useLock();
  const toast = useToast();

  const [data,        setData]        = useState<any>(null);
  const [parametres,  setParametres]  = useState<any>(null);
  const [lignes,      setLignes]      = useState<Record<string, string>>({});
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [nextM,       setNextM]       = useState(false);

  // P62 — derogation ARMEE par l utilisateur, envoyee au serveur et tracee.
  // Ce n est plus un deverrouillage local : le serveur reste seul juge.
  const [derogation,  setDerogation]  = useState(false);

  const [showHist,    setShowHist]    = useState(false);
  const [histData,    setHistData]    = useState<{ mois: number; annee: number; budget: any[] }[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  // Q67 — seules les categories modifiees depuis le dernier chargement sont
  // envoyees. Une categorie non touchee ne peut plus ecraser un ajout rapide,
  // un decaissement ou le cron du 1er.
  const dirtyCats = useRef<Set<string>>(new Set());

  // P64 — un chargement en cours est annule des qu un nouveau demarre.
  const abortBudget = useRef<AbortController | null>(null);
  const abortParams = useRef<AbortController | null>(null);
  const abortHist   = useRef<AbortController | null>(null);

  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();

  const groupIds = ORDRE_TYPES.map(t => `budget-${t}`);
  const { expandAll, collapseAll } = useCollapseAll(groupIds);

  useEffect(() => { purgerCachesObsoletes(); }, []);

  // ── P62 : etat de verrou ──────────────────────────────────────
  // La valeur du SERVEUR fait foi. estMoisVerrouille n est utilise qu avant
  // l arrivee de la reponse, et sur la meme regle exactement (I16) : les deux
  // ne peuvent pas diverger.
  const moisVerrouille: boolean = data?.verrouille ?? estMoisVerrouille(annee, mois);
  const ecritureBloquee = globalLocked || (moisVerrouille && !derogation);
  const joursRestants = joursAvantVerrou(annee, mois);

  // La derogation ne survit pas a un changement de mois.
  useEffect(() => { setDerogation(false); }, [mois, annee]);

  // ── I11 : parametres sans cache, revalides par ETag ───────────
  const chargerParametres = useCallback(async () => {
    abortParams.current?.abort();
    const ctrl = new AbortController();
    abortParams.current = ctrl;
    try {
      const res = await fetch('/api/parametres', { signal: ctrl.signal });
      if (!res.ok) {
        if (!ctrl.signal.aborted) toast.error(`Parametres indisponibles (HTTP ${res.status})`);
        return;
      }
      setParametres(await res.json());
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error('Parametres indisponibles');
    }
  }, [toast]);

  const charger = useCallback(async () => {
    abortBudget.current?.abort();
    const ctrl = new AbortController();
    abortBudget.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`, { signal: ctrl.signal });
      if (!res.ok) {
        if (!ctrl.signal.aborted) toast.error(`Chargement du budget impossible (HTTP ${res.status})`);
        return;
      }
      const d = await res.json();
      setData(d);

      const init: Record<string, string> = {};
      for (const cat of (d.categories ?? [])) {
        const b = (d.budget ?? []).find((x: any) => x.categorieId === cat.id);
        const v = toEntierPositif(b?.montantAnticipe);
        init[cat.id] = v > 0 ? String(v) : '';
      }
      setLignes(init);
      dirtyCats.current = new Set();
      setSaved(false);
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast.error('Chargement du budget impossible');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [mois, annee, toast]);

  useEffect(() => {
    charger();
    chargerParametres();
    return () => {
      abortBudget.current?.abort();
      abortParams.current?.abort();
      abortHist.current?.abort();
    };
  }, [charger, chargerParametres]);

  // ── Historique 3 mois ─────────────────────────────────────────
  const chargerHistorique = useCallback(async () => {
    abortHist.current?.abort();
    const ctrl = new AbortController();
    abortHist.current = ctrl;
    setLoadingHist(true);
    try {
      const resultats = await Promise.all([1, 2, 3].map(async i => {
        let m = mois - i;
        let a = annee;
        if (m <= 0) { m += 12; a--; }
        try {
          const r = await fetch(`/api/budget?annee=${a}&mois=${m}`, { signal: ctrl.signal });
          if (!r.ok) return { mois: m, annee: a, budget: [] as any[] };
          const d = await r.json();
          return { mois: m, annee: a, budget: d?.budget ?? [] };
        } catch {
          return { mois: m, annee: a, budget: [] as any[] };
        }
      }));
      if (!ctrl.signal.aborted) setHistData(resultats);
    } finally {
      if (!ctrl.signal.aborted) setLoadingHist(false);
    }
  }, [mois, annee]);

  useEffect(() => { if (showHist) chargerHistorique(); }, [showHist, chargerHistorique]);

  // ── I12 : allocation par type, memoisee ───────────────────────
  // P29 — lecture directe de parametres_types via ④. Aucune somme, aucun
  // produit, aucune division : ce fichier ne calcule plus d allocation.
  const revRef = Number(parametres?.revenuMensuelReference ?? 0);

  const allocParType = useMemo(() => {
    const out: Record<string, number> = {};
    const pt = parametres?.parType ?? {};
    for (const [type, v] of Object.entries(pt)) {
      out[type] = Number((v as any)?.montant ?? 0);
    }
    return out;
  }, [parametres]);

  const typesIncoherents = useMemo(() => {
    const pt = parametres?.parType ?? {};
    return Object.entries(pt)
      .filter(([, v]) => (v as any)?.coherent === false)
      .map(([t]) => t);
  }, [parametres]);

  // ── I17 : reference par CATEGORIE, produite par ⑤ ─────────────
  const refParCategorie = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of (parametres?.categories ?? [])) {
      out[c.id] = Number(c.montantReference ?? 0);
    }
    return out;
  }, [parametres]);

  const sommeRefCategories = useMemo(
    () => Object.values(refParCategorie).reduce((s, v) => s + v, 0),
    [refParCategorie],
  );

  // ⑤ n a pas encore tourne : les categories portent 0 alors que les types
  // portent une allocation. Recopier ces zeros effacerait le previsionnel.
  const repartitionManquante =
    sommeRefCategories === 0 && Number(parametres?.totalMontant ?? 0) > 0;

  // ── I15 : verification de l invariant R3-a a l ecran ──────────
  const ecartsInvariant = useMemo(() => {
    if (!parametres?.parType || !parametres?.categories) return [];
    const sommes: Record<string, number> = {};
    for (const c of parametres.categories) {
      sommes[c.type] = (sommes[c.type] ?? 0) + Number(c.montantReference ?? 0);
    }
    const out: Array<{ type: string; allocation: number; somme: number; ecart: number }> = [];
    for (const [type, alloc] of Object.entries(allocParType)) {
      const somme = sommes[type] ?? 0;
      // Un type sans categorie active est signale par ⑤, pas ici : ce bandeau
      // ne parle que des ecarts de CALCUL, pas des allocations orphelines.
      if (somme === 0 && alloc === 0) continue;
      const ecart = somme - alloc;
      if (Math.abs(ecart) > TOLERANCE_INVARIANT) out.push({ type, allocation: alloc, somme, ecart });
    }
    return out;
  }, [parametres, allocParType]);

  // ── Saisie ────────────────────────────────────────────────────
  const handleChange = (catId: string, brut: string) => {
    if (ecritureBloquee) return;
    const val = filtrerChiffres(brut);
    dirtyCats.current.add(catId);
    setLignes(l => ({ ...l, [catId]: val }));
    setSaved(false);
  };

  const cats = data?.categories ?? [];

  // ── P61 : appliquer la reference = RECOPIE, pas calcul ────────
  const appliquerReference = () => {
    if (ecritureBloquee) return;
    if (revRef <= 0) {
      toast.error('Configurez d abord le revenu mensuel dans Parametres.');
      return;
    }
    if (repartitionManquante) {
      toast.error(
        'La repartition par categorie n a pas encore ete calculee. '
        + 'Lancez-la depuis Parametres avant d appliquer la reference.',
      );
      return;
    }

    const concernees = cats.filter((c: any) => (refParCategorie[c.id] ?? 0) > 0);
    if (concernees.length === 0) {
      toast.error('Aucune categorie ne porte de budget de reference.');
      return;
    }
    const total = concernees.reduce((s: number, c: any) => s + refParCategorie[c.id], 0);

    if (!window.confirm(
      `Pre-remplir ${concernees.length} categorie(s) depuis le budget de reference `
      + `(${formatFCFA(total)}) ?\nLes previsions actuelles de ces categories seront remplacees.`
    )) return;

    setLignes(prev => {
      const next = { ...prev };
      for (const c of concernees) {
        next[c.id] = String(refParCategorie[c.id]);
        dirtyCats.current.add(c.id);
      }
      return next;
    });
    setSaved(false);
  };

  // ── P67 : import des recurrentes, flux separes et detail ──────
  const importerRecurrentes = async () => {
    if (ecritureBloquee) return;
    try {
      const res = await fetch('/api/recurrentes?actives=1');
      if (!res.ok) { toast.error(`Recurrentes indisponibles (HTTP ${res.status})`); return; }
      const d = await res.json();
      const recs: any[] = (d.recurrentes ?? []).filter((r: any) => r.isActive !== false);
      if (recs.length === 0) { toast.info('Aucune recurrente active pour le moment.'); return; }

      // typeFlux vaut 'decaissement' par defaut dans le schema. Le mapping par
      // categorieId est correct pour les deux sens ; seul l agregat annonce
      // etait faux quand les deux etaient additionnes (P67).
      const parCat: Record<string, number> = {};
      let totalSorties = 0;
      let totalEntrees = 0;
      let nbSorties = 0;
      let nbEntrees = 0;

      for (const r of recs) {
        const m = toEntierPositif(r.montant);
        if (!r.categorieId || m === 0) continue;
        parCat[r.categorieId] = (parCat[r.categorieId] ?? 0) + m;
        if (r.typeFlux === 'encaissement') { totalEntrees += m; nbEntrees++; }
        else { totalSorties += m; nbSorties++; }
      }

      const cibles = Object.keys(parCat).filter(id => cats.some((c: any) => c.id === id));
      if (cibles.length === 0) {
        toast.error('Aucune recurrente ne pointe vers une categorie active de ce mois.');
        return;
      }

      const nomDe = (id: string) => cats.find((c: any) => c.id === id)?.nom ?? id;
      const detail = cibles
        .slice(0, MAX_LIGNES_CONFIRMATION)
        .map(id => {
          const ancien = toEntierPositif(lignes[id]);
          return `  ${nomDe(id)} : ${formatFCFA(ancien)} -> ${formatFCFA(parCat[id])}`;
        })
        .join('\n');
      const reste = cibles.length > MAX_LIGNES_CONFIRMATION
        ? `\n  … et ${cibles.length - MAX_LIGNES_CONFIRMATION} autre(s)`
        : '';

      const entete =
        `Importer ${cibles.length} categorie(s) depuis les recurrentes ?\n\n`
        + (nbSorties > 0 ? `  Sorties : ${nbSorties} · ${formatFCFA(totalSorties)}\n` : '')
        + (nbEntrees > 0 ? `  Entrees : ${nbEntrees} · ${formatFCFA(totalEntrees)}\n` : '')
        + `\nDetail des remplacements :\n`;

      if (!window.confirm(entete + detail + reste)) return;

      setLignes(prev => {
        const next = { ...prev };
        for (const id of cibles) {
          next[id] = String(parCat[id]);
          dirtyCats.current.add(id);
        }
        return next;
      });
      setSaved(false);
    } catch {
      toast.error('Erreur lors de l import des recurrentes.');
    }
  };

  // ── Totaux ────────────────────────────────────────────────────
  const grouped = useMemo(
    () => ORDRE_TYPES
      .map(type => ({ type, items: cats.filter((c: any) => c.type === type) }))
      .filter(g => g.items.length > 0),
    [cats],
  );

  const totauxParType = useMemo(() => {
    const out: Record<string, number> = {};
    for (const { type, items } of grouped) {
      out[type] = items.reduce((s: number, c: any) => s + toEntierPositif(lignes[c.id]), 0);
    }
    return out;
  }, [grouped, lignes]);

  const revAnt = useMemo(
    () => cats.filter((c: any) => c.type === 'revenu')
      .reduce((s: number, c: any) => s + toEntierPositif(lignes[c.id]), 0),
    [cats, lignes],
  );
  const sortiesAnt = useMemo(
    () => cats.filter((c: any) => c.type !== 'revenu')
      .reduce((s: number, c: any) => s + toEntierPositif(lignes[c.id]), 0),
    [cats, lignes],
  );
  const soldeAnt = revAnt - sortiesAnt;

  // ── Sauvegarde ────────────────────────────────────────────────
  const sauvegarder = async () => {
    if (ecritureBloquee) return;

    const modifiees = Array.from(dirtyCats.current).filter(id => cats.some((c: any) => c.id === id));
    if (modifiees.length === 0) {
      toast.info('Aucune modification a enregistrer');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }

    const deficit = sortiesAnt - revAnt;
    if (deficit > 0) {
      const ok = window.confirm(
        `Budget deficitaire de ${formatFCFA(deficit)}\n`
        + `  Sorties : ${formatFCFA(sortiesAnt)}\n`
        + `  Revenus : ${formatFCFA(revAnt)}\n\nConfirmer quand meme ?`
      );
      if (!ok) return;
    }

    if (moisVerrouille && derogation) {
      const ok = window.confirm(
        `${MOIS_NOMS[mois]} ${annee} est un mois cloture.\n\n`
        + `Cette modification sera enregistree en DEROGATION et tracee dans le `
        + `journal d audit. Confirmer ?`
      );
      if (!ok) return;
    }

    // Q43 / Q61 — cle `anticipe` SEULE. La presence de `reel` avec ce scope
    // est refusee en 422 depuis ⑩b v3.
    const payload: Record<string, { anticipe: string }> = {};
    for (const catId of modifiees) {
      payload[catId] = { anticipe: String(toEntierPositif(lignes[catId])) };
    }

    setSaving(true);
    try {
      const res = await fetch('/api/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(data?.anneeId ? { anneeId: data.anneeId } : {}),
          annee,
          mois,
          scope: 'previsionnel',
          lignes: payload,
          ...(derogation ? { forcerMoisVerrouille: true } : {}),
        }),
      });

      // P60 — la reponse est lue. Un echec ne peut plus afficher « Sauvegarde ✓ ».
      if (!res.ok) {
        let message = `Erreur sauvegarde HTTP ${res.status}`;
        try {
          const err = await res.json();
          if (err?.error) message = String(err.error);
        } catch {}
        if (res.status === 423) {
          setDerogation(false);
          toast.error(`${message} Utilisez « Deroger » pour forcer l enregistrement.`);
        } else {
          toast.error(message);
        }
        return;
      }

      const corps = await res.json().catch(() => null);
      setSaved(true);
      toast.success(
        corps?.derogation
          ? 'Enregistre en derogation — modification tracee'
          : `Previsionnel enregistre (${modifiees.length} categorie(s))`,
      );
      dirtyCats.current = new Set();
      setTimeout(() => setSaved(false), 3000);
      await charger();
    } catch {
      toast.error('Erreur reseau lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // ── Copie vers le mois suivant ────────────────────────────────
  const copierVersProchainMois = async () => {
    const nm = mois === 12 ? 1 : mois + 1;
    const na = mois === 12 ? annee + 1 : annee;

    const aCopier = cats.filter((c: any) => toEntierPositif(lignes[c.id]) > 0);
    if (aCopier.length === 0) {
      toast.info('Aucune prevision a copier.');
      return;
    }
    if (!window.confirm(
      `Copier ${aCopier.length} prevision(s) vers ${MOIS_NOMS[nm]} ${na} ?\n`
      + `Cela remplacera les previsions existantes de ces categories.`
    )) return;

    // Le mois cible est toujours futur : jamais verrouille, donc pas de
    // derogation a prevoir ici. L annee est resolue par le serveur a partir du
    // champ `annee` : inutile d aller chercher un anneeId au prealable.
    const payload: Record<string, { anticipe: string }> = {};
    for (const c of aCopier) {
      payload[c.id] = { anticipe: String(toEntierPositif(lignes[c.id])) };
    }

    try {
      const res = await fetch('/api/budget', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annee: na, mois: nm, scope: 'previsionnel', lignes: payload }),
      });
      if (!res.ok) {
        let message = `Copie impossible (HTTP ${res.status})`;
        try {
          const err = await res.json();
          if (err?.error) message = String(err.error);
        } catch {}
        toast.error(message);
        return;
      }
      setNextM(true);
      toast.success(`Previsions copiees vers ${MOIS_NOMS[nm]} ${na}`);
      setTimeout(() => setNextM(false), 3000);
    } catch {
      toast.error('Erreur reseau lors de la copie');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  const pctRevRef  = revRef  > 0 ? Math.round((revAnt / revRef) * 100) : null;
  const pctSorties = revAnt  > 0 ? Math.round((sortiesAnt / revAnt) * 100) : null;
  const nbColHist  = showHist && !loadingHist ? histData.length : 0;

  return (
    <div className="space-y-5 animate-fadeIn">

      <EnveloppesSection mois={mois} annee={annee} />
      <BandeauMoisAnterieur mois={mois} annee={annee}
        onMoisCourant={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }}
      />

      {/* ── I15 : invariant R3-a rompu ──────────────────────────── */}
      {ecartsInvariant.length > 0 && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
            <ShieldAlert size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700 dark:text-red-300 space-y-1">
              <p className="font-semibold text-sm">Repartition incoherente</p>
              <p>
                La somme des budgets de reference ne correspond pas a l allocation du type.
                Une ecriture a contourne le calcul central : relancez la repartition depuis
                Parametres.
              </p>
              <ul className="pl-4 list-disc">
                {ecartsInvariant.map(e => (
                  <li key={e.type}>
                    {TYPE_LABELS[e.type as keyof typeof TYPE_LABELS] ?? e.type} —
                    {' '}alloue {formatFCFA(e.allocation)}, porte {formatFCFA(e.somme)}
                    {' '}(ecart {e.ecart > 0 ? '+' : ''}{formatFCFA(e.ecart)})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {typesIncoherents.length === 0 ? null : (
        <div className="max-w-4xl mx-auto w-full">
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <span>
              Taux et montants desynchronises sur{' '}
              {typesIncoherents.map(t => TYPE_LABELS[t as keyof typeof TYPE_LABELS] ?? t).join(', ')}.
              Ouvrez Parametres et sauvegardez les taux pour resynchroniser.
            </span>
          </div>
        </div>
      )}

      {repartitionManquante && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-xs text-blue-700 dark:text-blue-300">
            <Info size={15} className="flex-shrink-0 mt-0.5" />
            <span>
              L allocation par type est definie, mais elle n a pas encore ete repartie sur les
              categories. La colonne « Ref. » restera vide jusque-la.
            </span>
          </div>
        </div>
      )}

      {/* ── P62 : verrou ─────────────────────────────────────────── */}
      {moisVerrouille && (
        <div className="max-w-4xl mx-auto w-full">
          <div className={clsx(
            'flex items-center justify-between gap-3 rounded-xl px-4 py-3 border',
            derogation
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
          )}>
            <div className="flex items-center gap-2.5">
              {derogation
                ? <LockOpen size={15} className="text-red-500 flex-shrink-0" />
                : <Lock size={15} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />}
              <div>
                <p className={clsx('text-sm font-semibold',
                  derogation ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300')}>
                  {derogation
                    ? `Derogation armee — ${MOIS_NOMS[mois]} ${annee}`
                    : `Mois cloture — ${MOIS_NOMS[mois]} ${annee}`}
                </p>
                <p className={clsx('text-xs',
                  derogation ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                  {derogation
                    ? 'Toute sauvegarde sera enregistree et tracee dans le journal d audit.'
                    : (data?.messageVerrou ?? 'Ecritures fermees pour preserver l historique.')}
                </p>
              </div>
            </div>
            {!globalLocked && (
              <button onClick={() => setDerogation(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex-shrink-0',
                  derogation
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200',
                )}>
                {derogation ? <Lock size={12} /> : <LockOpen size={12} />}
                {derogation ? 'Annuler la derogation' : 'Deroger'}
              </button>
            )}
          </div>
        </div>
      )}

      {!moisVerrouille && joursRestants !== null && joursRestants <= 3 && (
        <div className="max-w-4xl mx-auto w-full">
          <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span>
              Cloture de {MOIS_NOMS[mois]} {annee} dans {joursRestants} jour(s) — apres quoi les
              modifications passeront en derogation.
            </span>
          </div>
        </div>
      )}

      {/* ── En-tete ──────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">
            Budget Prévisionnel de{' '}
            <span className="text-primary">{MOIS_NOMS[mois]} {annee}</span>
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            Montants prévisionnels · Comparé au budget de référence
            {revRef > 0 && (
              <span className="ml-1.5 text-primary font-medium">
                ({formatFCFA(revRef)}/mois)
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {revRef > 0 && !ecritureBloquee && (
            <button onClick={appliquerReference} disabled={repartitionManquante}
              className="flex items-center gap-1.5 border border-primary/30 bg-primary/5 hover:bg-primary/10
                text-primary rounded-xl px-3 py-2 text-xs font-medium transition-all disabled:opacity-40">
              <Sparkles size={13} />Appliquer référence
            </button>
          )}
          {!ecritureBloquee && (
            <button onClick={importerRecurrentes}
              className="flex items-center gap-1.5 border border-violet-300/40 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30
                text-violet-600 dark:text-violet-300 rounded-xl px-3 py-2 text-xs font-medium transition-all">
              <RefreshCw size={13} />Importer récurrentes
            </button>
          )}
          <button onClick={() => setShowHist(v => !v)}
            className={clsx('flex items-center gap-1.5 border rounded-xl px-3 py-2 text-xs font-medium transition-all',
              showHist
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]')}>
            <History size={13} />{showHist ? 'Masquer hist.' : '3 mois'}
          </button>
          <button onClick={collapseAll}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)]
              hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={expandAll}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)]
              hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={copierVersProchainMois}
            className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)]
              text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card">
            <Copy size={14} />{nextM ? 'Copié ✓' : '→ Mois suivant'}
          </button>
          {!ecritureBloquee && (
            <button onClick={sauvegarder} disabled={saving}
              className={clsx(
                'flex items-center gap-2 text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60',
                derogation ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark',
              )}>
              <Save size={14} />
              {saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : derogation ? 'Sauvegarder (dérogation)' : 'Sauvegarder'}
            </button>
          )}
        </div>
      </div>

      {/* ── Bandeau de cohérence globale ─────────────────────────── */}
      {revRef > 0 && (
        <div className="max-w-4xl mx-auto w-full">
        <div className={clsx(
          'rounded-2xl border p-4 space-y-3 transition-colors',
          soldeAnt >= 0
            ? 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800'
        )}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              {soldeAnt >= 0
                ? <TrendingUp size={16} className="text-green-600 dark:text-green-400" />
                : <AlertTriangle size={16} className="text-red-500" />}
              <span className="font-semibold text-sm text-[var(--text)]">
                {soldeAnt >= 0 ? 'Budget équilibré' : 'Budget déficitaire'}
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Revenus prévus</p>
                <p className="font-bold text-[var(--text)]">{formatFCFA(revAnt)}</p>
                {pctRevRef !== null && (
                  <p className={clsx('text-xs font-semibold',
                    pctRevRef >= 95 ? 'text-green-600' : pctRevRef >= 80 ? 'text-amber-500' : 'text-red-500')}>
                    {pctRevRef}% de la réf.
                  </p>
                )}
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Total sorties</p>
                <p className="font-bold text-[var(--text)]">{formatFCFA(sortiesAnt)}</p>
                {pctSorties !== null && (
                  <p className={clsx('text-xs font-semibold',
                    pctSorties <= 90 ? 'text-green-600' : pctSorties <= 100 ? 'text-amber-500' : 'text-red-500')}>
                    {pctSorties}% des revenus
                  </p>
                )}
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Solde</p>
                <p className={clsx('font-bold text-lg', soldeAnt >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {formatFCFA(soldeAnt)}
                </p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Budget réf.</p>
                <p className="font-bold text-primary">{formatFCFA(revRef)}</p>
                <p className={clsx('text-xs font-semibold',
                  revAnt >= revRef ? 'text-green-600' : 'text-amber-500')}>
                  écart {formatFCFA(revAnt - revRef)}
                </p>
              </div>
            </div>
          </div>

          {revAnt > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>Sorties allouées sur revenus</span>
                <span>{pctSorties}% · {formatFCFA(sortiesAnt)} / {formatFCFA(revAnt)}</span>
              </div>
              <ProgressBar value={sortiesAnt} max={revAnt}
                color={pctSorties !== null && pctSorties > 100 ? 'bg-red-500' :
                       pctSorties !== null && pctSorties > 90  ? 'bg-amber-400' : 'bg-green-500'} />
            </div>
          )}
        </div>
        </div>
      )}

      {/* ── Tableau principal ────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto w-full">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                  <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">
                    Catégorie
                  </th>
                  {showHist && !loadingHist && histData.map(h => (
                    <th key={`${h.annee}-${h.mois}`}
                      className="text-right px-3 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase w-24 opacity-50">
                      {MOIS_COURTS[h.mois]} {h.annee !== annee ? h.annee : ''}
                    </th>
                  ))}
                  {showHist && loadingHist && (
                    <th className="px-4 py-3 text-center text-xs text-[var(--text-muted)]" colSpan={3}>
                      <div className="spinner inline-block" />
                    </th>
                  )}
                  {/* I17 — reference par categorie, produite par ⑤ */}
                  <th className="text-right px-3 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase w-28">
                    Réf.
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">
                    {LABEL_PREVISION} (FCFA)
                  </th>
                </tr>
              </thead>
            </table>
          </div>

          {grouped.map(({ type, items }) => {
            const sousTotal = totauxParType[type] ?? 0;
            const reference = allocParType[type] ?? 0;   // P29
            const ecart     = sousTotal - reference;
            const pctGrp    = reference > 0 ? Math.round((sousTotal / reference) * 100) : null;
            const isOver    = type !== 'revenu' && reference > 0 && ecart > 0;
            const isLow     = type === 'revenu' && reference > 0 && sousTotal < reference * 0.9;
            const badgeColor = isOver ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-primary dark:text-blue-400';

            return (
              <CollapsibleGroup
                key={type}
                id={`budget-${type}`}
                label={TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                badge={formatFCFA(sousTotal)}
                badgeColor={badgeColor}
                defaultOpen={false}
              >
                {reference > 0 && (
                  <div className={clsx(
                    'mx-4 mb-3 mt-2 rounded-xl p-3 border text-xs',
                    isOver ? 'bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800' :
                    isLow  ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800' :
                             'bg-blue-50 dark:bg-blue-900/15 border-blue-200 dark:border-blue-800'
                  )}>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[var(--text-muted)]">
                          Réf. : <strong className="text-[var(--text)]">{formatFCFA(reference)}</strong>
                        </span>
                        <span className="text-[var(--text-muted)]">
                          Prév. : <strong className={clsx(isOver ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-primary')}>
                            {formatFCFA(sousTotal)}
                          </strong>
                        </span>
                      </div>
                      <span className={clsx('px-2.5 py-1 rounded-full font-bold',
                        isOver
                          ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                          : isLow
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                          : 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400')}>
                        {ecart > 0 ? '+' : ''}{formatFCFA(ecart)}&nbsp;({pctGrp}%)
                      </span>
                    </div>
                    <div className="space-y-1">
                      <ProgressBar value={sousTotal} max={reference}
                        color={isOver ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-green-500'} />
                      <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                        <span>0</span>
                        <span>{pctGrp}% de la référence</span>
                        <span>{formatFCFA(reference)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((cat: any) => {
                        const refCat = refParCategorie[cat.id] ?? 0;
                        const valCat = toEntierPositif(lignes[cat.id]);
                        const depasse = type !== 'revenu' && refCat > 0 && valCat > refCat;
                        return (
                          <tr key={cat.id}
                            className={clsx(
                              'border-t border-[var(--border)] hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors',
                              depasse && 'bg-red-50/30 dark:bg-red-900/10',
                            )}>
                            <td className="px-4 py-2.5 text-[var(--text)]">
                              <div className="flex items-center gap-2">
                                {depasse && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                                <span className="truncate">{cat.nom}</span>
                              </div>
                            </td>
                            {showHist && !loadingHist && histData.map((h, i) => {
                              const b   = h.budget.find((x: any) => x.categorieId === cat.id);
                              const val = toEntierPositif(b?.montantAnticipe);
                              return (
                                <td key={i} className="px-3 py-2 text-right text-xs text-[var(--text-muted)] w-24">
                                  {val > 0 ? formatFCFA(val) : <span className="opacity-30">—</span>}
                                </td>
                              );
                            })}
                            {/* I17 — reference de CETTE categorie */}
                            <td className="px-3 py-2 text-right text-xs text-[var(--text-muted)] w-28">
                              {refCat > 0 ? formatFCFA(refCat) : <span className="opacity-30">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={lignes[cat.id] ?? ''}
                                onChange={e => handleChange(cat.id, e.target.value)}
                                readOnly={ecritureBloquee}
                                placeholder="0"
                                className={clsx(
                                  'w-40 text-right border rounded-lg px-2 py-1.5 text-sm outline-none transition-all',
                                  ecritureBloquee
                                    ? 'border-[var(--border)] bg-slate-50 dark:bg-dark-card text-[var(--text-muted)] cursor-not-allowed opacity-60'
                                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--text)] focus:border-primary'
                                )}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                        <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase"
                          colSpan={nbColHist + 1}>
                          Sous-total
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-[var(--text-muted)] w-28">
                          {reference > 0 ? formatFCFA(reference) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">
                          {formatFCFA(sousTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CollapsibleGroup>
            );
          })}

          <div className="border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10">
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
              <span className="font-semibold text-[var(--text)] text-sm">Total sorties (épargne + dépenses)</span>
              <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(sortiesAnt)}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="font-bold text-[var(--text)]">Solde disponible</span>
              <span className={clsx('font-bold text-lg',
                soldeAnt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500')}>
                {formatFCFA(soldeAnt)}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── Comparaison graphique ────────────────────────────────── */}
      {revRef > 0 && (
        <div className="max-w-4xl mx-auto w-full bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-primary" />
            <h3 className="font-semibold text-[var(--text)] text-sm">
              Comparaison Prévisionnel vs Référence
            </h3>
            <span className="text-xs text-[var(--text-muted)] ml-1">— par grande catégorie</span>
          </div>
          <div className="space-y-4">
            {grouped.map(({ type }) => {
              const sousTotal = totauxParType[type] ?? 0;
              const reference = allocParType[type] ?? 0;
              if (reference === 0 && sousTotal === 0) return null;
              const maxVal = Math.max(sousTotal, reference, 1);
              const isOver = type !== 'revenu' && reference > 0 && sousTotal > reference;

              return (
                <div key={type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text)] w-44 truncate">
                      {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                    </span>
                    <div className="flex items-center gap-3 text-[var(--text-muted)]">
                      {reference > 0 && <span className="opacity-60">Réf. {formatFCFA(reference)}</span>}
                      <span className={clsx('font-semibold', isOver ? 'text-red-500' : 'text-[var(--text)]')}>
                        Prév. {formatFCFA(sousTotal)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)] w-14 text-right flex-shrink-0">Prév.</span>
                    <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full transition-all duration-500', isOver ? 'bg-red-500' : 'bg-primary')}
                        style={{ width: `${Math.round((sousTotal / maxVal) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] w-8 text-right flex-shrink-0">
                      {Math.round((sousTotal / maxVal) * 100)}%
                    </span>
                  </div>
                  {reference > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-muted)] w-14 text-right flex-shrink-0">Réf.</span>
                      <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-slate-300 dark:bg-slate-600 transition-all duration-500"
                          style={{ width: `${Math.round((reference / maxVal) * 100)}%` }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] w-8 text-right flex-shrink-0">
                        {Math.round((reference / maxVal) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-2 rounded-sm bg-primary" />Prévisionnel
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-2 rounded-sm bg-slate-300 dark:bg-slate-600" />Budget référence
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-2 rounded-sm bg-red-500" />Dépassement
            </div>
          </div>
        </div>
      )}

      {revRef === 0 && (
        <div className="max-w-4xl mx-auto w-full flex items-center gap-2.5 rounded-xl bg-slate-50 dark:bg-dark-card border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
          <Info size={15} className="flex-shrink-0 text-primary" />
          <span>
            Configurez un revenu de référence dans{' '}
            <a href="/parametres" className="text-primary font-medium hover:underline">
              Paramètres → Catégories
            </a>{' '}
            pour activer les indicateurs de comparaison et le graphique.
          </span>
        </div>
      )}

    </div>
  );
}
