'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Save, Copy, ChevronsDownUp, ChevronsUpDown,
  Sparkles, Lock, LockOpen, AlertTriangle,
  TrendingUp, BarChart2, History, Info,
} from 'lucide-react';
import CollapsibleGroup, { useCollapseAll } from '@/components/CollapsibleGroup';
import BandeauMoisAnterieur from '@/components/BandeauMoisAnterieur';
import { formatFCFA, ORDRE_TYPES, TYPE_LABELS, MOIS_LABELS, LABEL_PREVISION } from '@/types';
import { clsx } from 'clsx';
import { useMois } from '../layout';

/* ────────────────────────────────────────────────────────────── */
const TYPES_OUVERTS: string[] = []; // Tout plié par défaut

const MOIS_NOMS   = ['','Janvier','Février','Mars','Avril','Mai','Juin',
                     'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun',
                     'Jul','Aoû','Sep','Oct','Nov','Déc'];

// P8 — Clé cache sessionStorage (5 minutes)
const CACHE_KEY = 'gestbudget-params-cache-v2';

// ── Composant : Mini barre de progression ───────────────────────
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

  const [data,        setData]        = useState<any>(null);
  const [lignes,      setLignes]      = useState<Record<string, string>>({});
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [nextM,       setNextM]       = useState(false);
  // P6 — Verrouillage mois passés
  const [locked,      setLocked]      = useState(false);
  // P8 — Référence (paramètres avec cache)
  const [parametres,  setParametres]  = useState<any>(null);
  // P5 — Historique 3 mois
  const [showHist,    setShowHist]    = useState(false);
  const [histData,    setHistData]    = useState<{ mois: number; annee: number; budget: any[] }[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();

  const groupIds = ORDRE_TYPES.map(t => `budget-${t}`);
  const { expandAll, collapseAll } = useCollapseAll(groupIds);

  // ── P6 : Détection verrouillage ──────────────────────────────
  useEffect(() => {
    const today   = new Date();
    const isPast  = annee < today.getFullYear() ||
      (annee === today.getFullYear() && mois < today.getMonth() + 1);
    // Verrouille après le 5e jour du mois suivant
    const lockAt  = new Date(annee, mois, 5); // mois (0-indexed js) = mois suivant
    setLocked(isPast && today > lockAt);
  }, [mois, annee]);

  // ── P8 : Paramètres avec cache sessionStorage ─────────────────
  const chargerParametres = useCallback(async () => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const { d, ts } = JSON.parse(raw);
        if (Date.now() - ts < 5 * 60_000) { setParametres(d); return; }
      }
    } catch {}
    try {
      const res = await fetch('/api/parametres');
      if (res.ok) {
        const d = await res.json();
        setParametres(d);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ d, ts: Date.now() })); } catch {}
      }
    } catch {}
  }, []);

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (res.ok) {
      const d = await res.json();
      setData(d);
      const init: Record<string, string> = {};
      for (const cat of d.categories) {
        const b = d.budget.find((b: any) => b.categorieId === cat.id);
        init[cat.id] = b?.montantAnticipe ? String(b.montantAnticipe) : '';
      }
      setLignes(init);
    }
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { charger(); chargerParametres(); }, [charger, chargerParametres]);

  // ── P5 : Charger 3 derniers mois ─────────────────────────────
  const chargerHistorique = useCallback(async () => {
    setLoadingHist(true);
    const promises = [1, 2, 3].map(i => {
      let m = mois - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      return fetch(`/api/budget?annee=${a}&mois=${m}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => ({ mois: m, annee: a, budget: d?.budget ?? [] }))
        .catch(() => ({ mois: m, annee: a, budget: [] }));
    });
    setHistData(await Promise.all(promises));
    setLoadingHist(false);
  }, [mois, annee]);

  useEffect(() => { if (showHist) chargerHistorique(); }, [showHist, chargerHistorique]);

  // ── Calculs référence ─────────────────────────────────────────
  const revRef = Number(parametres?.revenuMensuelReference ?? 0);

  const refParType = useCallback((type: string): number => {
    if (!parametres?.categories || revRef <= 0) return 0;
    const taux = parametres.categories
      .filter((c: any) => c.type === type)
      .reduce((s: number, c: any) => s + (c.tauxReference ?? 0), 0);
    return Math.round(revRef * taux / 100);
  }, [parametres, revRef]);

  // ── P1 : Appliquer budget de référence ───────────────────────
  const appliquerReference = () => {
    if (revRef <= 0) {
      alert('Configurez d\'abord le revenu mensuel dans Paramètres → Catégories.');
      return;
    }
    if (!window.confirm(
      `Pré-remplir depuis le budget de référence (${formatFCFA(revRef)}/mois) ?\n` +
      `Les valeurs actuelles seront remplacées.`
    )) return;

    const cats = data?.categories ?? [];
    const newLignes = { ...lignes };
    for (const type of ORDRE_TYPES) {
      const catsType = cats.filter((c: any) => c.type === type);
      const refTotal = refParType(type);
      if (refTotal > 0 && catsType.length > 0) {
        const parCat = Math.round(refTotal / catsType.length);
        catsType.forEach((cat: any, idx: number) => {
          // Dernier prend le reste pour éviter les erreurs d'arrondi
          newLignes[cat.id] = idx === catsType.length - 1
            ? String(refTotal - parCat * (catsType.length - 1))
            : String(parCat);
        });
      }
    }
    setLignes(newLignes);
  };

  // ── Sauvegarde (P7 : validation dépassement) ──────────────────
  const sauvegarder = async () => {
    if (!data?.anneeId || locked) return;

    const cats      = data?.categories ?? [];
    const revTotal  = cats.filter((c: any) => c.type === 'revenu')
      .reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
    const sortTotal = cats.filter((c: any) => c.type !== 'revenu')
      .reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
    const deficit   = sortTotal - revTotal;

    if (deficit > 0) {
      const ok = window.confirm(
        `⚠️ Budget déficitaire de ${formatFCFA(deficit)}\n` +
        `  Sorties : ${formatFCFA(sortTotal)}\n` +
        `  Revenus : ${formatFCFA(revTotal)}\n\nConfirmer quand même ?`
      );
      if (!ok) return;
    }

    setSaving(true);
    const lignesFormatted: Record<string, { anticipe: string; reel: string }> = {};
    for (const [catId, val] of Object.entries(lignes)) {
      const b = data.budget.find((b: any) => b.categorieId === catId);
      lignesFormatted[catId] = { anticipe: val, reel: String(b?.montantReel ?? 0) };
    }
    await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anneeId: data.anneeId, mois, lignes: lignesFormatted }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const copierVersProchainMois = async () => {
    const nm = mois === 12 ? 1         : mois + 1;
    const na = mois === 12 ? annee + 1 : annee;
    if (!window.confirm(`Copier vers ${MOIS_NOMS[nm]} ${na} ?\nCela remplacera les prévisions existantes.`)) return;
    const resNext = await fetch(`/api/budget?annee=${na}&mois=${nm}`);
    if (!resNext.ok) return;
    const dNext = await resNext.json();
    if (!dNext.anneeId) return;
    const lignesNext: Record<string, { anticipe: string; reel: string }> = {};
    for (const [catId, val] of Object.entries(lignes)) {
      lignesNext[catId] = { anticipe: val, reel: '0' };
    }
    await fetch('/api/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anneeId: dNext.anneeId, mois: nm, lignes: lignesNext }),
    });
    setNextM(true);
    setTimeout(() => setNextM(false), 3000);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  const cats    = data?.categories ?? [];
  const grouped = ORDRE_TYPES
    .map(type => ({ type, items: cats.filter((c: any) => c.type === type) }))
    .filter(g => g.items.length > 0);

  const revAnt     = cats.filter((c: any) => c.type === 'revenu')
    .reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
  const sortiesAnt = cats.filter((c: any) => c.type !== 'revenu')
    .reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
  const soldeAnt   = revAnt - sortiesAnt;

  // KPIs bandeau P2
  const pctRevRef  = revRef > 0 ? Math.round((revAnt     / revRef) * 100) : null;
  const pctSorties = revAnt > 0 ? Math.round((sortiesAnt / revAnt) * 100) : null;

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Bandeau mois antérieur */}
      <BandeauMoisAnterieur mois={mois} annee={annee}
        onMoisCourant={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }}
      />

      {/* ── P6 : Bannière verrouillage ─────────────────────────── */}
      {locked && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Lock size={15} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Budget verrouillé — {MOIS_NOMS[mois]} {annee}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Mois passé · modifications désactivées pour préserver l'historique.
              </p>
            </div>
          </div>
          <button onClick={() => setLocked(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/40
              text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-200 transition-all flex-shrink-0">
            <LockOpen size={12} />Déverrouiller
          </button>
        </div>
      )}

      {/* ── En-tête ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
          {/* P1 — Appliquer référence */}
          {revRef > 0 && !locked && (
            <button onClick={appliquerReference}
              className="flex items-center gap-1.5 border border-primary/30 bg-primary/5 hover:bg-primary/10
                text-primary rounded-xl px-3 py-2 text-xs font-medium transition-all">
              <Sparkles size={13} />Appliquer référence
            </button>
          )}
          <button onClick={() => { setShowHist(v => !v); }}
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
          {!locked && (
            <button onClick={sauvegarder} disabled={saving}
              className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl
                px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
              <Save size={14} />{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
            </button>
          )}
        </div>
      </div>

      {/* ── P2 : Bandeau cohérence globale ─────────────────────── */}
      {revRef > 0 && (
        <div className={clsx(
          'rounded-2xl border p-4 space-y-3 transition-colors',
          soldeAnt >= 0
            ? 'bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800'
        )}>
          {/* KPIs ligne */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              {soldeAnt >= 0
                ? <TrendingUp size={16} className="text-green-600 dark:text-green-400" />
                : <AlertTriangle size={16} className="text-red-500" />}
              <span className="font-semibold text-sm text-[var(--text)]">
                {soldeAnt >= 0 ? '✓ Budget équilibré' : '⚠️ Budget déficitaire'}
              </span>
            </div>
            <div className="flex items-center gap-5 flex-wrap text-sm">
              {/* Revenus vs ref */}
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
              {/* Sorties */}
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
              {/* Solde */}
              <div className="text-center">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Solde</p>
                <p className={clsx('font-bold text-lg', soldeAnt >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {formatFCFA(soldeAnt)}
                </p>
              </div>
              <div className="h-8 w-px bg-[var(--border)]" />
              {/* Référence */}
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

          {/* Barre de sorties */}
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
      )}

      {/* ── Tableau principal ────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto w-full">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">

          {/* En-tête tableau */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                  <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">
                    Catégorie
                  </th>
                  {/* P5 : colonnes historique */}
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
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">
                    {LABEL_PREVISION} (FCFA)
                  </th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Groupes */}
          {grouped.map(({ type, items }) => {
            const sousTotal = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
            const reference = refParType(type);
            const ecart     = sousTotal - reference;
            const pctGrp    = reference > 0 ? Math.round((sousTotal / reference) * 100) : null;
            // P3 — Couleurs selon dépassement
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
                {/* ── Option C : Indicateur comparaison (barre + badge) ── */}
                {reference > 0 && (
                  <div className={clsx(
                    'mx-4 mb-3 mt-2 rounded-xl p-3 border text-xs',
                    isOver ? 'bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800' :
                    isLow  ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800' :
                             'bg-blue-50 dark:bg-blue-900/15 border-blue-200 dark:border-blue-800'
                  )}>
                    {/* Badges */}
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
                      {/* Badge écart */}
                      <span className={clsx('px-2.5 py-1 rounded-full font-bold',
                        isOver
                          ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                          : isLow
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                          : 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400')}>
                        {ecart > 0 ? '+' : ''}{formatFCFA(ecart)}&nbsp;
                        ({pctGrp}%)&nbsp;
                        {isOver ? '⚠️' : isLow ? '↓' : '✓'}
                      </span>
                    </div>
                    {/* Barre de progression */}
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

                {/* Lignes catégories */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((cat: any) => {
                        const catVal = parseInt(lignes[cat.id]) || 0;
                        return (
                          <tr key={cat.id}
                            className="border-t border-[var(--border)] hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                            <td className="px-4 py-2.5 text-[var(--text)]">{cat.nom}</td>
                            {/* P5 : valeurs historiques */}
                            {showHist && !loadingHist && histData.map((h, i) => {
                              const b   = h.budget.find((b: any) => b.categorieId === cat.id);
                              const val = b?.montantAnticipe ?? 0;
                              return (
                                <td key={i} className="px-3 py-2 text-right text-xs text-[var(--text-muted)] w-24">
                                  {val > 0 ? formatFCFA(val) : <span className="opacity-30">—</span>}
                                </td>
                              );
                            })}
                            {/* Input prévisionnel */}
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                value={lignes[cat.id] ?? ''}
                                onChange={e => !locked && setLignes(l => ({ ...l, [cat.id]: e.target.value }))}
                                readOnly={locked}
                                placeholder="0"
                                className={clsx(
                                  'w-40 text-right border rounded-lg px-2 py-1.5 text-sm outline-none transition-all',
                                  locked
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
                          colSpan={showHist && !loadingHist ? histData.length + 1 : 1}>
                          Sous-total
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

          {/* Totaux */}
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

      {/* ── P4 : Graphique barres horizontales ───────────────────── */}
      {revRef > 0 && (
        <div className="max-w-4xl mx-auto w-full bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={15} className="text-primary" />
            <h3 className="font-semibold text-[var(--text)] text-sm">
              Comparaison Prévisionnel vs Référence
            </h3>
            <span className="text-xs text-[var(--text-muted)] ml-1">
              — par grande catégorie
            </span>
          </div>
          <div className="space-y-4">
            {grouped.map(({ type, items }) => {
              const sousTotal = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]) || 0), 0);
              const reference = refParType(type);
              if (reference === 0 && sousTotal === 0) return null;
              const maxVal = Math.max(sousTotal, reference, 1);
              const isOver = type !== 'revenu' && sousTotal > reference && reference > 0;

              return (
                <div key={type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text)] w-44 truncate">
                      {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                    </span>
                    <div className="flex items-center gap-3 text-[var(--text-muted)]">
                      {reference > 0 && (
                        <span className="opacity-60">Réf. {formatFCFA(reference)}</span>
                      )}
                      <span className={clsx('font-semibold',
                        isOver ? 'text-red-500' : 'text-[var(--text)]')}>
                        Prév. {formatFCFA(sousTotal)}
                      </span>
                    </div>
                  </div>
                  {/* Barre Prévisionnel */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-muted)] w-14 text-right flex-shrink-0">Prév.</span>
                    <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all duration-500', isOver ? 'bg-red-500' : 'bg-primary')}
                        style={{ width: `${Math.round((sousTotal / maxVal) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] w-8 text-right flex-shrink-0">
                      {maxVal > 0 ? Math.round((sousTotal / maxVal) * 100) : 0}%
                    </span>
                  </div>
                  {/* Barre Référence */}
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
            }).filter(Boolean)}
          </div>
          {/* Légende */}
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

      {/* Note si pas de référence configurée */}
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
