'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, X, Pencil, Trash2, Repeat, Info, ArrowDownCircle, ArrowUpCircle, Wallet } from 'lucide-react';
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

const MOIS_PAR_AN = 12;

const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^\d$/.test(e.key)) e.preventDefault();
};

// Part relative : 1 décimale sous 10 %, entier au-delà (lisibilité).
const formatPct = (p: number) => (p < 10 ? p.toFixed(1) : Math.round(p).toString());

type Cat = { id: string; nom: string; type: string };
type Rec = {
  id: string;
  libelle: string;
  montant: number;
  typeFlux: 'decaissement' | 'encaissement';
  isActive: boolean;
  categorieId: string;
  categorie?: { id: string; nom: string; type: string };
};

export default function RecurrentesPage() {
  const toast = useToast();

  const [recs,      setRecs]      = useState<Rec[]>([]);
  const [cats,      setCats]      = useState<Cat[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing,   setEditing]   = useState<Rec | null>(null);
  const [saving,    setSaving]    = useState(false);

  // Formulaire
  const [flux,        setFlux]        = useState<'decaissement' | 'encaissement'>('decaissement');
  const [libelle,     setLibelle]     = useState('');
  const [montant,     setMontant]     = useState('');
  const [categorieId, setCategorieId] = useState('');

  // ── Chargement ──────────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const [rRec, rCats] = await Promise.all([
        fetch('/api/recurrentes'),
        fetch(`/api/budget?annee=${now.getFullYear()}&mois=${now.getMonth() + 1}`),
      ]);
      if (rRec.ok) {
        const d = await rRec.json();
        setRecs(d.recurrentes ?? []);
      }
      if (rCats.ok) {
        const d = await rCats.json();
        setCats((d.categories ?? []).map((c: any) => ({ id: c.id, nom: c.nom, type: c.type })));
      }
    } catch {
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { charger(); }, [charger]);

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
  // Comparer un loyer au total « décaissements + encaissements » n'aurait
  // aucun sens dès qu'un salaire figure dans la liste.
  const partDuFlux = useCallback((r: Rec): number | null => {
    if (!r.isActive) return null;                        // n'entre pas dans la projection
    const base = r.typeFlux === 'decaissement' ? stats.decMois : stats.encMois;
    if (base <= 0) return null;
    return (r.montant / base) * 100;
  }, [stats.decMois, stats.encMois]);

  // Décaissement → catégories hors revenu ; Encaissement → revenu uniquement
  const catsFiltrees = cats.filter(c =>
    flux === 'encaissement' ? c.type === 'revenu' : c.type !== 'revenu'
  );

  // ── Ouverture modale ────────────────────────────────────────────────────
  const ouvrirNouveau = () => {
    setEditing(null);
    setFlux('decaissement');
    setLibelle(''); setMontant(''); setCategorieId('');
    setModalOpen(true);
  };

  const ouvrirEdition = (r: Rec) => {
    setEditing(r);
    setFlux(r.typeFlux);
    setLibelle(r.libelle);
    setMontant(String(r.montant));
    setCategorieId(r.categorieId ?? r.categorie?.id ?? '');
    setModalOpen(true);
  };

  const fermer = () => { setModalOpen(false); setEditing(null); };

  // ── Enregistrer (création ou modification) ──────────────────────────────
  const enregistrer = async () => {
    const m = parseInt(montant, 10);                     // S7 : radix explicite
    if (!libelle.trim()) { toast.error('Libellé requis'); return; }
    if (!m || m <= 0)    { toast.error('Montant invalide'); return; }
    if (!categorieId)    { toast.error('Choisissez une catégorie'); return; }
    setSaving(true);
    try {
      const payload = editing
        ? { id: editing.id, libelle: libelle.trim(), montant: m, categorieId, typeFlux: flux }
        : { libelle: libelle.trim(), montant: m, categorieId, typeFlux: flux };
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
        toast.error(err?.message ?? 'Erreur');
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
      else toast.error('Erreur');
    } catch {
      toast.error('Erreur réseau');
    }
  };

  // ── Supprimer ───────────────────────────────────────────────────────────
  const supprimer = async (r: Rec) => {
    if (!window.confirm(`Supprimer la récurrente "${r.libelle}" ?\nSon historique de générations sera aussi supprimé.`)) return;
    try {
      const res = await fetch(`/api/recurrentes?id=${r.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Supprimée ✓'); charger(); }
      else toast.error('Erreur');
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

      {/* ── Explainer ── */}
      <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 dark:bg-dark-card border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
        <Info size={15} className="flex-shrink-0 text-primary mt-0.5" />
        <span>
          Les récurrentes <strong>actives</strong> incrémentent le réel du suivi mensuel le 1er du mois (marquées <span className="text-violet-600 dark:text-violet-300 font-medium">🔄 auto</span>).
          Tu peux aussi les pré-remplir dans le budget prévisionnel via <strong>Importer récurrentes</strong>.
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

      {/* ── Liste ── */}
      {recs.length === 0 ? (
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
      )}

      {/* ── Modale création / édition ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={fermer} />
          <div className="relative bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm sm:mx-4 overflow-hidden animate-fadeIn">
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
