'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, X, Pencil, Trash2, Repeat, Info, ArrowDownCircle, ArrowUpCircle, Wallet,
  ChevronLeft, ChevronRight, CalendarDays, Check, Bell, AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { formatFCFA } from '@/types';

// ── Gestion des récurrentes (S6) ──────────────────────────────────────────────
// CRUD complet sur /api/recurrentes. Les récurrentes actives sont générées
// automatiquement le 1er de chaque mois dans le suivi (badge 🔄), et peuvent
// aussi être importées manuellement dans le budget prévisionnel.
//
// ── S7 / F10 : coût annualisé ────────────────────────────────────────────────
// Toutes les récurrentes sont mensuelles (générées le 1er de chaque mois) :
// la projection annuelle est donc montant × 12.
//
// Choix d'implémentation : calcul 100 % côté client à partir de `recs`, déjà
// entièrement chargé. Aucun appel réseau supplémentaire, aucune nouvelle route
// (donc aucune surface Zod/CSRF ajoutée), aucune migration.
//
// `totalMensuel` renvoyé par l'API n'est volontairement plus utilisé : sa règle
// d'agrégation (net ou décaissements seuls) n'est pas garantie côté front.
// Tout est recalculé localement, ce qui supprime l'ambiguïté.
//
// ── S10 / F5b : échéances et pointage des paiements ──────────────────────────
// Le pointage vit dans la table dédiée `recurrentes_paiements`, JAMAIS dans
// `recurrentes_executions` (garde d'idempotence du cron mensuel) ni dans
// `budget_mensuel`. Pointer un paiement n'a strictement aucun effet sur le
// budget : c'est une case à cocher personnelle, pas une écriture comptable.
//
// La page est donc scopée à une PÉRIODE (mois + année) : un pointage n'a de
// sens que relativement à un mois. La période est choisie ici et transmise
// explicitement à l'API — jamais déduite côté serveur, sinon septembre
// deviendrait impointable dès le 1er octobre.
//
// Vue « Échéances du mois » (option B, S10) : récurrentes actives ayant un jour
// d'échéance, PLUS les inactives déjà pointées sur la période. Sans cette
// seconde population, une récurrente résiliée après paiement disparaîtrait de
// la liste en restant pointée, sans moyen de la dépointer.
//
// ── S21 / P124 : message de confirmation de suppression ──────────────────────
// La suppression a deux issues distinctes côté serveur (P102) :
//   • historique de générations présent  → soft delete, rien n'est perdu ;
//   • aucune génération                  → suppression DURE, qui cascade en
//     base sur `recurrentes_executions` ET sur `recurrentes_paiements`.
// Le second cas est atteignable en pratique : une récurrente créée puis pointée
// à la main, sans avoir jamais été générée par le cron, perd la totalité de ses
// pointages — toutes périodes confondues, pas seulement celle affichée. Le
// nombre exact n'est pas connu du client, qui ne charge que la période courante :
// le message avertit sans avancer de chiffre.

const MOIS_PAR_AN = 12;

// Bornes du sélecteur, alignées sur celles de l'API (ANNEE_MIN / MOIS_AVANCE_MAX
// dans app/api/recurrentes/paiements/route.ts). Toute divergence produirait un
// 422 sur une période que l'interface aurait pourtant laissé sélectionner.
const ANNEE_MIN = 2020;
const MOIS_AVANCE_MAX = 1;

const NOMS_MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^\d$/.test(e.key)) e.preventDefault();
};

// Part relative : 1 décimale sous 10 %, entier au-delà (lisibilité).
const formatPct = (p: number) => (p < 10 ? p.toFixed(1) : Math.round(p).toString());

const pad2 = (n: number) => String(n).padStart(2, '0');

// Rang absolu de mois : permet de comparer deux périodes sans manipuler de Date.
const rangMois = (annee: number, mois: number) => annee * 12 + (mois - 1);

type Cat = { id: string; nom: string; type: string };

type Rec = {
  id: string;
  libelle: string;
  montant: number;
  typeFlux: 'decaissement' | 'encaissement';
  isActive: boolean;
  categorieId: string;
  jourEcheance: number | null;
  rappelActif: boolean;
  rappelJoursAvant: number;
  categorie?: { id: string; nom: string; type: string };
};

type Paiement = { recurrenteId: string; payeAt: string };

type Statut =
  | { code: 'paye';       label: string; ton: 'vert' }
  | { code: 'retard';     label: string; ton: 'rouge' }
  | { code: 'aujourdhui'; label: string; ton: 'ambre' }
  | { code: 'avenir';     label: string; ton: 'neutre' };

export default function RecurrentesPage() {
  const toast = useToast();

  // ── Période sélectionnée ────────────────────────────────────────────────
  const maintenant = useMemo(() => new Date(), []);
  const rangCourant = rangMois(maintenant.getFullYear(), maintenant.getMonth() + 1);

  const [annee, setAnnee] = useState(maintenant.getFullYear());
  const [mois,  setMois]  = useState(maintenant.getMonth() + 1);

  const periodeStr = `${annee}-${pad2(mois)}`;
  const rangSelection = rangMois(annee, mois);
  const estMoisCourant = rangSelection === rangCourant;
  const estPasse = rangSelection < rangCourant;

  const peutReculer = rangSelection > rangMois(ANNEE_MIN, 1);
  const peutAvancer = rangSelection < rangCourant + MOIS_AVANCE_MAX;

  const [recs,      setRecs]      = useState<Rec[]>([]);
  const [cats,      setCats]      = useState<Cat[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing,   setEditing]   = useState<Rec | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [vue,       setVue]       = useState<'echeances' | 'toutes'>('echeances');

  // Pointages en cours : évite le double envoi sur double clic.
  const [enCours, setEnCours] = useState<string[]>([]);

  // Formulaire
  const [flux,        setFlux]        = useState<'decaissement' | 'encaissement'>('decaissement');
  const [libelle,     setLibelle]     = useState('');
  const [montant,     setMontant]     = useState('');
  const [categorieId, setCategorieId] = useState('');
  const [jour,        setJour]        = useState('');
  const [rappel,      setRappel]      = useState(false);
  const [rappelJours, setRappelJours] = useState('3');

  // ── Chargement ──────────────────────────────────────────────────────────
  // Un seul appel ramène récurrentes + paiements de la période (S10) : le champ
  // `paiements` a été ajouté au GET /api/recurrentes pour éviter un 3e fetch.
  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [rRec, rCats] = await Promise.all([
        fetch(`/api/recurrentes?periode=${periodeStr}`),
        fetch(`/api/budget?annee=${annee}&mois=${mois}`),
      ]);
      if (rRec.ok) {
        const d = await rRec.json();
        setRecs(d.recurrentes ?? []);
        setPaiements(d.paiements ?? []);
      }
      if (rCats.ok) {
        const d = await rCats.json();
        setCats((d.categories ?? []).map((c: any) => ({ id: c.id, nom: c.nom, type: c.type })));
      }
    } catch {
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  }, [toast, periodeStr, annee, mois]);

  useEffect(() => { charger(); }, [charger]);

  // Index paiements : recurrenteId → date de pointage
  const paiementParRec = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of paiements) m.set(p.recurrenteId, p.payeAt);
    return m;
  }, [paiements]);

  // ── S7 / F10 : agrégats mensuels et annualisés ──────────────────────────
  // Seules les récurrentes ACTIVES entrent dans la projection : une récurrente
  // désactivée n'est pas générée par le cron, elle ne coûte rien.
  const stats = useMemo(() => {
    const actives = recs.filter(r => r.isActive);

    const decMois = actives
      .filter(r => r.typeFlux === 'decaissement')
      .reduce((s, r) => s + r.montant, 0);

    const encMois = actives
      .filter(r => r.typeFlux === 'encaissement')
      .reduce((s, r) => s + r.montant, 0);

    return {
      nbActives: actives.length,
      decMois,
      encMois,
      netMois: encMois - decMois,
      decAn:   decMois * MOIS_PAR_AN,
      encAn:   encMois * MOIS_PAR_AN,
      netAn:   (encMois - decMois) * MOIS_PAR_AN,
    };
  }, [recs]);

  // Part d'une récurrente dans le total annuel de SON flux.
  const partDuFlux = useCallback((r: Rec): number | null => {
    if (!r.isActive) return null;
    const base = r.typeFlux === 'decaissement' ? stats.decMois : stats.encMois;
    if (base <= 0) return null;
    return (r.montant / base) * 100;
  }, [stats.decMois, stats.encMois]);

  // ── S10 / F5b : liste des échéances de la période (option B) ────────────
  const echeances = useMemo(() => {
    return recs
      .filter(r =>
        r.jourEcheance !== null &&
        (r.isActive || paiementParRec.has(r.id))
      )
      .sort((a, b) => (a.jourEcheance ?? 99) - (b.jourEcheance ?? 99));
  }, [recs, paiementParRec]);

  const nbPayees = useMemo(
    () => echeances.filter(r => paiementParRec.has(r.id)).length,
    [echeances, paiementParRec]
  );

  // Statut d'une échéance, relatif à la période affichée et non à aujourd'hui.
  const statutDe = useCallback((r: Rec): Statut => {
    const payeAt = paiementParRec.get(r.id);
    if (payeAt) {
      const d = new Date(payeAt);
      return { code: 'paye', ton: 'vert', label: `Payé le ${d.getDate()}/${pad2(d.getMonth() + 1)}` };
    }
    const j = r.jourEcheance ?? 1;

    if (estPasse) return { code: 'retard', ton: 'rouge', label: 'Non pointé' };
    if (!estMoisCourant) return { code: 'avenir', ton: 'neutre', label: `Le ${j}` };

    const jourAuj = maintenant.getDate();
    if (j < jourAuj)  return { code: 'retard', ton: 'rouge', label: `En retard (le ${j})` };
    if (j === jourAuj) return { code: 'aujourdhui', ton: 'ambre', label: "Aujourd'hui" };

    const reste = j - jourAuj;
    return { code: 'avenir', ton: 'neutre', label: `Dans ${reste} j` };
  }, [paiementParRec, estPasse, estMoisCourant, maintenant]);

  // ── Pointer / dépointer ─────────────────────────────────────────────────
  const basculerPaiement = async (r: Rec) => {
    if (enCours.includes(r.id)) return;
    const dejaPaye = paiementParRec.has(r.id);
    setEnCours(prev => prev.concat([r.id]));

    try {
      const res = dejaPaye
        ? await fetch(`/api/recurrentes/paiements?recurrenteId=${encodeURIComponent(r.id)}&periode=${periodeStr}`, {
            method: 'DELETE',
          })
        : await fetch('/api/recurrentes/paiements', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ recurrenteId: r.id, periode: periodeStr }),
          });

      if (res.ok) {
        if (dejaPaye) {
          setPaiements(prev => prev.filter(p => p.recurrenteId !== r.id));
        } else {
          const d = await res.json().catch(() => null);
          const payeAt = d?.paiement?.payeAt ?? new Date().toISOString();
          setPaiements(prev => prev.concat([{ recurrenteId: r.id, payeAt }]));
        }
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? err?.message ?? 'Erreur de pointage'); // P105
      }
    } catch {
      toast.error('Erreur réseau');
    }

    setEnCours(prev => prev.filter(id => id !== r.id));
  };

  // Décaissement → catégories hors revenu ; Encaissement → revenu uniquement
  const catsFiltrees = cats.filter(c =>
    flux === 'encaissement' ? c.type === 'revenu' : c.type !== 'revenu'
  );

  // ── Navigation de période ───────────────────────────────────────────────
  const reculer = () => {
    if (!peutReculer) return;
    if (mois === 1) { setMois(12); setAnnee(a => a - 1); } else setMois(m => m - 1);
  };
  const avancer = () => {
    if (!peutAvancer) return;
    if (mois === 12) { setMois(1); setAnnee(a => a + 1); } else setMois(m => m + 1);
  };
  const revenirAujourdhui = () => {
    setAnnee(maintenant.getFullYear());
    setMois(maintenant.getMonth() + 1);
  };

  // ── Ouverture modale ────────────────────────────────────────────────────
  const ouvrirNouveau = () => {
    setEditing(null);
    setFlux('decaissement');
    setLibelle(''); setMontant(''); setCategorieId('');
    setJour(''); setRappel(false); setRappelJours('3');
    setModalOpen(true);
  };

  const ouvrirEdition = (r: Rec) => {
    setEditing(r);
    setFlux(r.typeFlux);
    setLibelle(r.libelle);
    setMontant(String(r.montant));
    setCategorieId(r.categorieId ?? r.categorie?.id ?? '');
    setJour(r.jourEcheance !== null && r.jourEcheance !== undefined ? String(r.jourEcheance) : '');
    setRappel(!!r.rappelActif);
    setRappelJours(String(r.rappelJoursAvant ?? 3));
    setModalOpen(true);
  };

  const fermer = () => { setModalOpen(false); setEditing(null); };

  // ── Enregistrer (création ou modification) ──────────────────────────────
  // Les bornes reproduisent EXACTEMENT les schémas Zod serveur, eux-mêmes
  // alignés sur les CHECK Neon (jourEcheance 1..31, rappelJoursAvant 0..15).
  const enregistrer = async () => {
    const m = parseInt(montant, 10);
    if (!libelle.trim()) { toast.error('Libellé requis'); return; }
    if (!m || m <= 0)    { toast.error('Montant invalide'); return; }
    if (!categorieId)    { toast.error('Choisissez une catégorie'); return; }

    let jourNum: number | null = null;
    if (jour.trim() !== '') {
      jourNum = parseInt(jour, 10);
      if (isNaN(jourNum) || jourNum < 1 || jourNum > 31) {
        toast.error('Jour d\u2019échéance invalide (1 à 31)'); return;
      }
    }
    if (rappel && jourNum === null) {
      toast.error('Un jour d\u2019échéance est requis pour activer le rappel'); return;
    }

    const rj = parseInt(rappelJours, 10);
    if (isNaN(rj) || rj < 0 || rj > 15) {
      toast.error('Rappel : entre 0 et 15 jours avant'); return;
    }

    setSaving(true);
    try {
      const base = {
        libelle: libelle.trim(),
        montant: m,
        categorieId,
        typeFlux: flux,
        jourEcheance: jourNum,
        rappelActif: rappel,
        rappelJoursAvant: rj,
      };
      const payload = editing ? { id: editing.id, ...base } : base;

      const res = await fetch('/api/recurrentes', {
        method:  editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success(editing ? 'Récurrente modifiée ✓' : 'Récurrente créée ✓');
        fermer();
        charger();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? err?.message ?? 'Erreur'); // P105
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSaving(false);
  };

  // ── Activer / désactiver ────────────────────────────────────────────────
  const basculer = async (r: Rec) => {
    try {
      const res = await fetch('/api/recurrentes', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: r.id, isActive: !r.isActive }),
      });
      if (res.ok) charger();
      else { const err = await res.json().catch(() => null); toast.error(err?.error ?? err?.message ?? 'Erreur'); } // P105
    } catch {
      toast.error('Erreur réseau');
    }
  };

  // ── Supprimer ───────────────────────────────────────────────────────────
  // P124 — le message énonce les DEUX issues possibles et nomme ce qui est
  // détruit dans chacune. La version précédente ne mentionnait que la garde
  // d'idempotence du cron, en taisant la cascade sur `recurrentes_paiements` :
  // l'utilisateur pouvait perdre des mois de pointages sans avoir été averti.
  const supprimer = async (r: Rec) => {
    const message =
      `Supprimer la récurrente « ${r.libelle} » ?\n\n` +
      `Deux cas possibles, tranchés par le serveur :\n\n` +
      `1. Elle a déjà été générée par le cron\n` +
      `   → elle est DÉSACTIVÉE, pas supprimée. Historique de générations et ` +
      `pointages conservés. La garde qui empêche une double génération reste en place.\n\n` +
      `2. Elle n'a jamais été générée\n` +
      `   → SUPPRESSION DÉFINITIVE. Tous les pointages de paiement associés sont ` +
      `supprimés avec elle, sur TOUTES les périodes, pas seulement le mois affiché.\n\n` +
      `Dans les deux cas, les montants déjà écrits dans le budget ne sont pas touchés.`;

    if (!window.confirm(message)) return;

    try {
      const res = await fetch(`/api/recurrentes?id=${r.id}`, { method: 'DELETE' });
      if (res.ok) {
        // P102 : le serveur désactive au lieu de supprimer quand un historique
        // de générations existe. L'écran doit dire lequel des deux a eu lieu.
        const d = await res.json().catch(() => null);
        toast.success(
          d?.soft
            ? 'Désactivée ✓ — historique et pointages conservés'
            : 'Supprimée ✓ — pointages associés supprimés'
        );
        charger();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? err?.message ?? 'Erreur'); // P105
      }
    } catch {
      toast.error('Erreur réseau');
    }
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !saving) enregistrer();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  const netPositif = stats.netAn >= 0;

  const tonClasses: Record<string, string> = {
    vert:   'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    rouge:  'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    ambre:  'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
    neutre: 'bg-slate-100 dark:bg-dark-card text-[var(--text-muted)]',
  };

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <Repeat size={22} className="text-primary" />Récurrentes
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            Opérations générées automatiquement le 1er de chaque mois
          </p>
        </div>
        <button onClick={ouvrirNouveau}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-4 py-2 text-sm font-medium transition-all">
          <Plus size={16} />Nouvelle récurrente
        </button>
      </div>

      {/* ── Sélecteur de période ── */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <button onClick={reculer} disabled={!peutReculer} title="Mois précédent"
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent">
          <ChevronLeft size={18} />
        </button>

        <div className="text-center">
          <p className="font-semibold text-[var(--text)] text-sm flex items-center justify-center gap-2">
            <CalendarDays size={15} className="text-primary" />
            {NOMS_MOIS[mois - 1]} {annee}
          </p>
          {!estMoisCourant && (
            <button onClick={revenirAujourdhui}
              className="text-[11px] text-primary hover:underline mt-0.5">
              Revenir au mois courant
            </button>
          )}
        </div>

        <button onClick={avancer} disabled={!peutAvancer} title="Mois suivant"
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Explainer ── */}
      <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 dark:bg-dark-card border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
        <Info size={15} className="flex-shrink-0 text-primary mt-0.5" />
        <span>
          Les récurrentes <strong>actives</strong> incrémentent le réel du suivi mensuel le 1er du mois (marquées <span className="text-violet-600 dark:text-violet-300 font-medium">🔄 auto</span>).
          Le <strong>pointage</strong> des paiements est un suivi personnel : il n'a aucun effet sur le budget.
          Les montants annuels sont une projection sur 12 mois des seules récurrentes actives.
        </span>
      </div>

      {/* ── S7 / F10 : synthèse annualisée ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Décaissements / an */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5">
            <ArrowDownCircle size={13} className="text-red-500 flex-shrink-0" />
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide truncate">Décaissements / an</p>
          </div>
          <p className="text-xl font-bold text-red-500 mt-1.5">{formatFCFA(stats.decAn)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{formatFCFA(stats.decMois)} / mois</p>
        </div>

        {/* Encaissements / an */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5">
            <ArrowUpCircle size={13} className="text-green-500 flex-shrink-0" />
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide truncate">Encaissements / an</p>
          </div>
          <p className="text-xl font-bold text-green-500 mt-1.5">{formatFCFA(stats.encAn)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{formatFCFA(stats.encMois)} / mois</p>
        </div>

        {/* Net / an */}
        <div className={`rounded-2xl border p-4 ${
          netPositif
            ? 'border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10'
            : 'border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10'
        }`}>
          <div className="flex items-center gap-1.5">
            <Wallet size={13} className={`flex-shrink-0 ${netPositif ? 'text-green-600' : 'text-red-500'}`} />
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide truncate">Net récurrent / an</p>
          </div>
          <p className={`text-xl font-bold mt-1.5 ${netPositif ? 'text-green-600' : 'text-red-500'}`}>
            {netPositif ? '+' : '−'}{formatFCFA(Math.abs(stats.netAn))}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {netPositif ? '+' : '−'}{formatFCFA(Math.abs(stats.netMois))} / mois
          </p>
        </div>

        {/* Compteur */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5">
            <Repeat size={13} className="text-primary flex-shrink-0" />
            <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide truncate">Récurrentes</p>
          </div>
          <p className="text-xl font-bold text-[var(--text)] mt-1.5">
            {stats.nbActives}
            <span className="text-sm text-[var(--text-muted)] font-normal"> / {recs.length}</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">active(s)</p>
        </div>

      </div>

      {/* ── Bascule de vue ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setVue('echeances')}
          className={`px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
            vue === 'echeances'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
          }`}>
          Échéances du mois
          {echeances.length > 0 && (
            <span className="ml-1.5 text-xs opacity-70">{nbPayees}/{echeances.length}</span>
          )}
        </button>
        <button onClick={() => setVue('toutes')}
          className={`px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
            vue === 'toutes'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
          }`}>
          Toutes <span className="ml-1.5 text-xs opacity-70">{recs.length}</span>
        </button>
      </div>

      {/* ── Vue échéances ── */}
      {vue === 'echeances' && (
        echeances.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
            <CalendarDays size={32} className="mx-auto text-[var(--text-muted)] opacity-40" />
            <p className="mt-3 text-[var(--text)] font-medium">Aucune échéance ce mois</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Renseigne un jour d&apos;échéance sur une récurrente pour la voir apparaître ici.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {echeances.map(r => {
              const estDecaiss = r.typeFlux === 'decaissement';
              const paye       = paiementParRec.has(r.id);
              const statut     = statutDe(r);
              const busy       = enCours.includes(r.id);
              return (
                <div key={r.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                    paye
                      ? 'border-green-200 dark:border-green-900/40 bg-green-50/40 dark:bg-green-900/10'
                      : 'border-[var(--border)] bg-[var(--surface)]'
                  } ${r.isActive ? '' : 'opacity-70'}`}>

                  {/* Case de pointage */}
                  <button onClick={() => basculerPaiement(r)} disabled={busy}
                    title={paye ? 'Dépointer ce paiement' : 'Marquer comme payé'}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border transition-all disabled:opacity-40 ${
                      paye
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-[var(--border)] text-transparent hover:border-primary hover:text-primary/40'
                    }`}>
                    <Check size={16} />
                  </button>

                  {/* Jour */}
                  <div className="w-10 text-center flex-shrink-0">
                    <p className="text-lg font-bold text-[var(--text)] leading-none">{r.jourEcheance}</p>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase">{NOMS_MOIS[mois - 1].slice(0, 3)}</p>
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold truncate ${paye ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text)]'}`}>
                        {r.libelle}
                      </span>
                      {!r.isActive && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-dark-card text-[var(--text-muted)]">
                          inactive
                        </span>
                      )}
                      {r.rappelActif && (
                        <span title={`Rappel ${r.rappelJoursAvant} j avant`}>
                          <Bell size={12} className="text-primary" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${tonClasses[statut.ton]}`}>
                        {statut.code === 'retard' && <AlertTriangle size={10} className="inline mr-0.5 -mt-0.5" />}
                        {statut.label}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] truncate">{r.categorie?.nom ?? '—'}</span>
                    </div>
                  </div>

                  {/* Montant */}
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm leading-tight ${estDecaiss ? 'text-red-500' : 'text-green-500'}`}>
                      {estDecaiss ? '−' : '+'}{formatFCFA(r.montant)}
                    </p>
                  </div>

                  <button onClick={() => ouvrirEdition(r)} title="Modifier"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0">
                    <Pencil size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Vue complète (CRUD) ── */}
      {vue === 'toutes' && (
        recs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
            <Repeat size={32} className="mx-auto text-[var(--text-muted)] opacity-40" />
            <p className="mt-3 text-[var(--text)] font-medium">Aucune récurrente</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Crée ta première récurrente (loyer, abonnement, salaire…) pour automatiser ta saisie.
            </p>
            <button onClick={ouvrirNouveau}
              className="mt-4 inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-4 py-2 text-sm font-medium transition-all">
              <Plus size={16} />Nouvelle récurrente
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recs.map(r => {
              const estDecaiss = r.typeFlux === 'decaissement';
              const annuel     = r.montant * MOIS_PAR_AN;
              const part       = partDuFlux(r);
              return (
                <div key={r.id}
                  className={`flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-all ${r.isActive ? '' : 'opacity-55'}`}>
                  {/* Icône flux */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    estDecaiss ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'
                  }`}>
                    {estDecaiss
                      ? <ArrowDownCircle size={18} className="text-red-500" />
                      : <ArrowUpCircle size={18} className="text-green-500" />}
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--text)] truncate">{r.libelle}</span>
                      {!r.isActive && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-dark-card text-[var(--text-muted)]">
                          inactive
                        </span>
                      )}
                      {r.jourEcheance !== null && r.jourEcheance !== undefined && (
                        <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                          le {r.jourEcheance}
                        </span>
                      )}
                      {r.rappelActif && (
                        <span title={`Rappel ${r.rappelJoursAvant} j avant`}>
                          <Bell size={12} className="text-primary" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {r.categorie?.nom ?? '—'} · {estDecaiss ? 'Décaissement' : 'Encaissement'}
                    </p>
                  </div>

                  {/* Montant mensuel + projection annuelle (S7 / F10) */}
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm leading-tight ${estDecaiss ? 'text-red-500' : 'text-green-500'}`}>
                      {estDecaiss ? '−' : '+'}{formatFCFA(r.montant)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5 whitespace-nowrap">
                      {formatFCFA(annuel)} / an
                      {part !== null && (
                        <span className={`ml-1.5 font-medium ${estDecaiss ? 'text-red-400' : 'text-green-400'}`}>
                          · {formatPct(part)} %
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Toggle actif — S7 FIX : h-5.5 n'existe pas dans l'échelle Tailwind */}
                  <button onClick={() => basculer(r)} title={r.isActive ? 'Désactiver' : 'Activer'}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      r.isActive ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
                    }`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                      r.isActive ? 'left-[22px]' : 'left-0.5'
                    }`} />
                  </button>

                  {/* Actions */}
                  <button onClick={() => ouvrirEdition(r)} title="Modifier"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-primary hover:bg-primary/10 transition-colors flex-shrink-0">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => supprimer(r)} title="Supprimer"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Modale création / édition ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={fermer} />
          <div className="relative bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm sm:mx-4 overflow-hidden animate-fadeIn max-h-[90vh] overflow-y-auto">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text)] flex items-center gap-2 text-sm">
                <Repeat size={15} className="text-primary" />
                {editing ? 'Modifier la récurrente' : 'Nouvelle récurrente'}
              </h3>
              <button onClick={fermer} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Toggle flux */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setFlux('decaissement'); setCategorieId(''); }}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                    flux === 'decaissement'
                      ? 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]'
                  }`}>
                  Décaissement
                </button>
                <button onClick={() => { setFlux('encaissement'); setCategorieId(''); }}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                    flux === 'encaissement'
                      ? 'border-green-300 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]'
                  }`}>
                  Encaissement
                </button>
              </div>

              {/* Libellé */}
              <input
                type="text" maxLength={100} autoFocus
                value={libelle} onChange={e => setLibelle(e.target.value)} onKeyDown={onEnter}
                placeholder="Libellé (ex : Loyer, Netflix, Salaire)"
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
              />

              {/* Montant */}
              <div>
                <input
                  type="number" inputMode="numeric"
                  value={montant} onChange={e => setMontant(e.target.value)} onKeyDown={e => { onlyNumbers(e); onEnter(e); }}
                  placeholder="Montant (FCFA)"
                  className="w-full text-right text-lg font-semibold border border-[var(--border)] rounded-xl px-3 py-2.5 bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                />
                {/* S7 / F10 : projection annuelle en temps réel dans le formulaire */}
                {(() => {
                  const m = parseInt(montant, 10);
                  if (!m || m <= 0) return null;
                  return (
                    <p className="text-xs text-[var(--text-muted)] text-right mt-1.5">
                      soit <span className="font-semibold text-[var(--text)]">{formatFCFA(m * MOIS_PAR_AN)}</span> / an
                    </p>
                  );
                })()}
              </div>

              {/* Catégorie */}
              <select value={categorieId} onChange={e => setCategorieId(e.target.value)}
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                <option value="">— Catégorie —</option>
                {catsFiltrees.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
              {catsFiltrees.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Aucune catégorie {flux === 'encaissement' ? 'de revenu' : 'de dépense'} disponible.
                </p>
              )}

              {/* ── S7 / F5 : échéance et rappel ── */}
              <div className="pt-1 border-t border-[var(--border)] space-y-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    Jour d&apos;échéance (optionnel)
                  </label>
                  <input
                    type="number" inputMode="numeric" min={1} max={31}
                    value={jour}
                    onChange={e => setJour(e.target.value)}
                    onKeyDown={e => { onlyNumbers(e); onEnter(e); }}
                    placeholder="1 à 31"
                    className="w-full mt-1 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    Sert au calendrier et aux rappels. La génération reste le 1er du mois.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--text)] flex items-center gap-1.5">
                    <Bell size={14} className="text-primary" />Rappel avant échéance
                  </span>
                  <button onClick={() => setRappel(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      rappel ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
                    }`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                      rappel ? 'left-[22px]' : 'left-0.5'
                    }`} />
                  </button>
                </div>

                {rappel && (
                  <div>
                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
                      Jours avant (0 à 15)
                    </label>
                    <input
                      type="number" inputMode="numeric" min={0} max={15}
                      value={rappelJours}
                      onChange={e => setRappelJours(e.target.value)}
                      onKeyDown={e => { onlyNumbers(e); onEnter(e); }}
                      className="w-full mt-1 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                    />
                    {jour.trim() === '' && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Un jour d&apos;échéance est requis pour activer le rappel.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button onClick={enregistrer} disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold transition-all disabled:opacity-50">
                {editing ? <Pencil size={15} /> : <Plus size={15} />}
                {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
