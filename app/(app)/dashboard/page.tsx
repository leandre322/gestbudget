'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
         CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Wallet, AlertTriangle,
         Shield, ChevronDown, ChevronRight, Building2, Pencil, X, Save,
         ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useMois } from '../layout';
import { formatFCFA, MOIS_COURTS, TYPE_LABELS, calculerScore, couleurScore, ORDRE_TYPES, LABEL_PREVISION } from '@/types';
import { useToast } from '@/components/Toast';
import { clsx } from 'clsx';

const COLORS = ['#1E40AF','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#84CC16'];

function DashboardModal({ isOpen, onClose, titre, children }: {
  isOpen: boolean; onClose: () => void; titre: string; children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-primary/5">
          <h3 className="font-bold text-[var(--text)]">✏️ {titre}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 max-h-[65vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Separateur({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">
        {emoji} {label}
      </span>
      <div className="flex-1 border-t border-[var(--border)]" />
    </div>
  );
}

// ── Onglet Global ─────────────────────────────────────────────────────────────
function OngletGlobal({
  moisCourant, anneeCourante, budgetMois, loadingMois,
}: {
  moisCourant: number; anneeCourante: number; budgetMois: any[]; loadingMois: boolean;
}) {
  const toast = useToast();
  const [data,        setData]        = useState<any>(null);
  const [banques,     setBanques]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [modalType,   setModalType]   = useState<string|null>(null);
  const [modalVals,   setModalVals]   = useState<Record<string, string>>({});
  const [savingModal, setSavingModal] = useState(false);

  const MOIS_NOMS: Record<number, string> = {
    1:'Janvier',2:'Février',3:'Mars',4:'Avril',5:'Mai',6:'Juin',
    7:'Juillet',8:'Août',9:'Septembre',10:'Octobre',11:'Novembre',12:'Décembre',
  };

  const chargerData = useCallback(() => {
    Promise.all([
      fetch('/api/dashboard/global').then(r => r.json()),
      fetch('/api/banques').then(r => r.json()),
    ]).then(([global, bqs]) => {
      setData({
        ...global,
        evolutionAnnuelle:     global.evolutionAnnuelle     ?? [],
        fondsRoulement:        global.fondsRoulement        ?? [],
        comptes:               global.comptes               ?? [],
        annees:                global.annees                ?? [],
        totalFonds:            global.totalFonds            ?? 0,
        totalRevenus:          global.totalRevenus          ?? 0,
        totalDepenses:         global.totalDepenses         ?? 0,
        solde:                 global.solde                 ?? 0,
        scoreGlobal:           global.scoreGlobal           ?? 0,
        nbMoisScore:           global.nbMoisScore           ?? 0,
        revenuReference:       global.revenuReference       ?? 0,
        nMoisUrgence:          global.nMoisUrgence          ?? 6,
        totalAjouts:           global.totalAjouts           ?? 0,
        totalDecaissements:    global.totalDecaissements    ?? 0,
        soldeNetDecaissements: global.soldeNetDecaissements ?? 0,
      });
      setBanques(bqs.banques ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [moisCourant, anneeCourante]);

  useEffect(() => { chargerData(); }, [chargerData]);

  const tot = (type: string, f: 'montantAnticipe'|'montantReel') =>
    budgetMois.filter((b: any) =>
      type==='depense' ? (b.categorie?.type?.startsWith('depense') || b.categorie?.type==='remboursement_dette') :
      b.categorie?.type === type
    ).reduce((s: number, b: any) => s + b[f], 0);

  const revenus  = { reel: tot('revenu','montantReel'),  ant: tot('revenu','montantAnticipe')  };
  const depenses = { reel: tot('depense','montantReel'), ant: tot('depense','montantAnticipe') };
  // Solde = Revenus - Dépenses - Épargne (formule inchangée)
  const epargneReel = budgetMois.filter((b: any) => b.categorie?.type?.startsWith('epargne')).reduce((s: number, b: any) => s + b.montantReel, 0);
  const epargneAnt  = budgetMois.filter((b: any) => b.categorie?.type?.startsWith('epargne')).reduce((s: number, b: any) => s + b.montantAnticipe, 0);
  const solde = revenus.reel - depenses.reel - epargneReel;
  const soldeAnt = revenus.ant - depenses.ant - epargneAnt;

  const fondsUrgence   = banques.reduce((s: number, b: any) => s + (b.solde ?? 0), 0);
  const revenuRef      = data?.revenuReference ?? 0;
  const nMoisUrgence   = data?.nMoisUrgence ?? 6;
  const fondsObjectif  = revenuRef > 0 ? revenuRef * nMoisUrgence : 0;
  const fondsNonConfig = revenuRef === 0;

  const { score, details } = calculerScore({
    totalDepenses: depenses.reel, totalDepAnt: depenses.ant,
    totalEpargne: epargneReel,    totalRevenus: revenus.reel,
    solde, fondsUrgence, fondsObjectif: fondsObjectif || 3720000,
  });

  const alertes = budgetMois
    .filter((b: any) => b.categorie?.type?.startsWith('depense') && b.montantAnticipe > 0 && b.montantReel > b.montantAnticipe)
    .map((b: any) => b.categorie?.nom);

  const ouvrirModal = (type: string) => {
    const init: Record<string, string> = {};
    if (type === 'urgence') {
      init['revenu'] = String(revenuRef);
      init['nMois']  = String(nMoisUrgence);
    } else if (type === 'banques') {
      banques.forEach(b => { init[b.id] = String(b.solde ?? 0); });
    } else {
      budgetMois
        .filter((b: any) => {
          if (type === 'revenus')  return b.categorie?.type === 'revenu';
          if (type === 'depenses') return b.categorie?.type?.startsWith('depense') || b.categorie?.type === 'remboursement_dette';
          return false;
        })
        .forEach((b: any) => { init[b.categorieId] = String(b.montantReel ?? 0); });
    }
    setModalVals(init);
    setModalType(type);
  };

  const sauvegarderModal = async () => {
    if (!modalType) return;
    setSavingModal(true);
    try {
      if (modalType === 'urgence') {
        await fetch('/api/parametres', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revenuMensuelReference: parseInt(modalVals['revenu'] || '0') || 0,
            nMoisUrgence:           parseInt(modalVals['nMois']  || '6') || 6,
          }),
        });
        toast.success('Fonds d\'urgence mis à jour ✓');
      } else if (modalType === 'banques') {
        for (const [id, s] of Object.entries(modalVals)) {
          await fetch(`/api/banques?id=${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set', montant: parseInt(s) || 0 }),
          });
        }
        toast.success('Soldes banques mis à jour ✓');
      } else {
        const anneeRes = await fetch(`/api/budget?annee=${anneeCourante}&mois=${moisCourant}`);
        if (anneeRes.ok) {
          const d = await anneeRes.json();
          const lignes: Record<string, { anticipe: string; reel: string }> = {};
          for (const b of d.budget) {
            lignes[b.categorieId] = {
              anticipe: String(b.montantAnticipe ?? 0),
              reel: modalVals[b.categorieId] !== undefined ? modalVals[b.categorieId] : String(b.montantReel ?? 0),
            };
          }
          await fetch('/api/budget', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anneeId: d.anneeId, mois: moisCourant, lignes }),
          });
          toast.success('Données mises à jour ✓');
        }
      }
      chargerData();
      setModalType(null);
    } catch { toast.error('Erreur lors de la sauvegarde'); }
    setSavingModal(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;
  if (!data) return null;

  const { totalRevenus, totalDepenses, solde: soldeGlobal,
          evolutionAnnuelle, fondsRoulement, totalFonds,
          totalAjouts, totalDecaissements } = data;

  const pctFonds  = fondsObjectif > 0 ? (fondsUrgence / fondsObjectif) * 100 : 0;
  const barColor  = pctFonds < 50 ? 'bg-red-500' : pctFonds < 80 ? 'bg-orange-400' : 'bg-green-500';
  const textColor = pctFonds < 50 ? 'text-red-500' : pctFonds < 80 ? 'text-orange-500' : 'text-green-600';
  const totalPrecaution = banques.reduce((s: number, b: any) => s + (b.solde ?? 0), 0);

  const catsByModalType = (type: string) => budgetMois.filter((b: any) => {
    if (type === 'revenus')  return b.categorie?.type === 'revenu';
    if (type === 'depenses') return b.categorie?.type?.startsWith('depense') || b.categorie?.type === 'remboursement_dette';
    return false;
  });

  return (
    <div className="space-y-5">

      {/* ── Modal ── */}
      <DashboardModal
        isOpen={modalType !== null}
        onClose={() => setModalType(null)}
        titre={
          modalType === 'urgence'  ? 'Fonds d\'urgence — Objectif' :
          modalType === 'banques'  ? 'Épargne Précaution — Soldes banques' :
          modalType === 'revenus'  ? `Revenus — ${MOIS_NOMS[moisCourant]} ${anneeCourante}` :
          modalType === 'depenses' ? `Dépenses — ${MOIS_NOMS[moisCourant]} ${anneeCourante}` : ''
        }>
        <div className="space-y-3">
          {modalType === 'urgence' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Revenu mensuel de référence (FCFA)</label>
                <input type="number" value={modalVals['revenu'] ?? ''}
                  className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                  onChange={e => setModalVals(p => ({ ...p, revenu: e.target.value }))} placeholder="Ex: 690 000" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Nombre de mois de précaution</label>
                <input type="number" value={modalVals['nMois'] ?? String(nMoisUrgence)} min="1" max="24"
                  className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                  onChange={e => setModalVals(p => ({ ...p, nMois: e.target.value }))} />
              </div>
              <div className="bg-primary/5 rounded-xl p-3">
                <p className="text-xs text-[var(--text-muted)]">Objectif calculé :</p>
                <p className="text-lg font-bold text-primary mt-1">
                  {formatFCFA((parseInt(modalVals['revenu'] || '0') || 0) * (parseInt(modalVals['nMois'] || '6') || 6))}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  = {formatFCFA(parseInt(modalVals['revenu'] || '0') || 0)} × {modalVals['nMois'] || nMoisUrgence} mois
                </p>
              </div>
            </div>
          )}
          {modalType === 'banques' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--text-muted)] mb-2">Modifier les soldes actuels :</p>
              {banques.map(b => (
                <div key={b.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-[var(--text)] font-medium">🏦 {b.nomBanque}</span>
                  <input type="number" value={modalVals[b.id] ?? ''}
                    className="w-36 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                    onChange={e => setModalVals(p => ({ ...p, [b.id]: e.target.value }))} placeholder="0" />
                </div>
              ))}
            </div>
          )}
          {(modalType === 'revenus' || modalType === 'depenses') && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[var(--text-muted)] uppercase pb-2 border-b border-[var(--border)]">
                <span>Catégorie</span>
                <span className="text-right">{LABEL_PREVISION} → Réel</span>
              </div>
              {catsByModalType(modalType).map((b: any) => (
                <div key={b.categorieId} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-[var(--text)] truncate">{b.categorie?.nom}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs text-[var(--text-muted)] w-24 text-right">
                      {b.montantAnticipe > 0 ? formatFCFA(b.montantAnticipe) : '—'}
                    </span>
                    <input type="number" value={modalVals[b.categorieId] ?? ''}
                      className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none"
                      onChange={e => setModalVals(p => ({ ...p, [b.categorieId]: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)] mt-4">
            <button onClick={() => setModalType(null)}
              className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all">
              Annuler
            </button>
            <button onClick={sauvegarderModal} disabled={savingModal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary-dark text-white transition-all disabled:opacity-60">
              <Save size={14} />{savingModal ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </DashboardModal>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* 1. MOIS COURANT                                           */}
      {/* ══════════════════════════════════════════════════════════ */}
      <Separateur emoji="📅" label={`${MOIS_NOMS[moisCourant]} ${anneeCourante} — Mois courant`} />

      {loadingMois ? (
        <div className="flex items-center justify-center h-20"><div className="spinner" /></div>
      ) : (
        <div className="space-y-3">
          {alertes.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3.5 flex items-start gap-2.5">
              <AlertTriangle size={17} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-600 dark:text-red-400 text-sm">⚠️ Dépassements détectés ce mois</p>
                <p className="text-red-500 dark:text-red-400 text-sm mt-0.5">{alertes.join(' · ')}</p>
              </div>
            </div>
          )}
          {/* ── KPIs mois courant : Revenus / Dépenses / Solde / Score (sans Épargne) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { titre: 'Revenus',  val: revenus.reel,  ant: revenus.ant,  type: 'revenus',  bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',    text: 'text-blue-700 dark:text-blue-400',   icon: TrendingUp },
              { titre: 'Dépenses', val: depenses.reel, ant: depenses.ant, type: 'depenses', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',        text: 'text-red-600 dark:text-red-400',     icon: TrendingDown },
              { titre: 'Solde',    val: solde,         ant: soldeAnt,     type: '',
                bg: solde >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
                text: solde >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400',
                icon: Wallet },
            ].map(k => (
              <div key={k.titre} className={clsx('rounded-2xl border p-4 flex flex-col gap-1 transition-colors', k.bg)}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium opacity-60">{k.titre}</p>
                  <div className="flex items-center gap-1">
                    <k.icon size={15} className="opacity-40" />
                    {k.type && (
                      <button onClick={() => ouvrirModal(k.type)}
                        className="p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors" title="Modifier">
                        <Pencil size={11} className="opacity-60" />
                      </button>
                    )}
                  </div>
                </div>
                <p className={clsx('text-xl font-bold', k.text)}>{formatFCFA(k.val)}</p>
                <p className="text-xs opacity-55">Prévision : {formatFCFA(k.ant)}</p>
              </div>
            ))}
            {/* Score financier */}
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 transition-colors">
              <p className="text-xs font-medium text-purple-500 dark:text-purple-400 mb-1">Score financier</p>
              <p className={clsx('text-2xl font-bold', couleurScore(score))}>
                {score}<span className="text-sm text-[var(--text-muted)] font-normal">/20</span>
              </p>
              <div className="mt-2 space-y-1">
                {details.map((d: any) => (
                  <div key={d.label} className="h-1 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                    <div className={clsx('h-full rounded-full',
                      d.pts >= d.max ? 'bg-green-500' : d.pts >= d.max/2 ? 'bg-amber-400' : 'bg-red-400')}
                      style={{ width: `${(d.pts/d.max)*100}%` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* 2. ÉPARGNES & FONDS                                       */}
      {/* ══════════════════════════════════════════════════════════ */}
      <Separateur emoji="💰" label="Épargnes & Fonds" />

      {/* Épargne de Fonctionnement */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--text)]">Épargne de Fonctionnement</h3>
          <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
        </div>
        {(fondsRoulement ?? []).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(fondsRoulement ?? []).map((f: any) => (
              <div key={f.id} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3">
                <p className="text-xs text-[var(--text-muted)] font-semibold truncate mb-2">{f.nom}</p>
                <p className="text-base font-bold text-primary">{formatFCFA(f.soldeActuel)}</p>
                <p className="text-xs text-[var(--text-muted)] mb-2">Solde actuel</p>
                <div className="space-y-1 pt-2 border-t border-[var(--border)]">
                  {f.totalBudgete > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">📥 Budgété</span>
                      <span className="font-medium text-[var(--text)]">{formatFCFA(f.totalBudgete)}</span>
                    </div>
                  )}
                  {f.totalAjout > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-green-600">↑ Ajouté</span>
                      <span className="font-medium text-green-600">{formatFCFA(f.totalAjout)}</span>
                    </div>
                  )}
                  {f.totalDecaisse > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-red-500">↓ Décaissé</span>
                      <span className="font-medium text-red-500">{formatFCFA(f.totalDecaisse)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] py-2">
            Aucun fond configuré.{' '}
            <a href="/parametres" className="text-primary underline">Ajouter dans Paramètres → Fonds</a>
          </p>
        )}
        <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Total Épargne de Fonctionnement</span>
          <span className="text-sm font-bold text-primary">{formatFCFA(totalFonds)}</span>
        </div>
      </div>

      {/* Épargne Précaution */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 size={17} className="text-primary" />
            <h3 className="font-semibold text-[var(--text)]">Épargne Précaution</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-primary">{formatFCFA(totalPrecaution)}</span>
            <button onClick={() => ouvrirModal('banques')}
              className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-dark-card transition-colors" title="Modifier les soldes">
              <Pencil size={13} className="text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
        {banques.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {banques.map((b: any) => (
              <div key={b.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                <p className="text-xs text-[var(--text-muted)] font-medium truncate">{b.nomBanque}</p>
                <p className="text-base font-bold text-primary mt-1">{formatFCFA(b.solde ?? 0)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)] py-2">
            Aucune banque configurée.{' '}
            <a href="/parametres" className="text-primary underline">Ajouter dans Paramètres → Banques</a>
          </p>
        )}
        <div className="pt-3 border-t border-[var(--border)] flex justify-between">
          <span className="text-sm font-semibold text-[var(--text-muted)]">Total Épargne Précaution</span>
          <span className="text-sm font-bold text-primary">{formatFCFA(totalPrecaution)}</span>
        </div>
      </div>

      {/* Fonds d'urgence */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield size={17} className="text-primary" />
            <h3 className="font-semibold text-[var(--text)]">Fonds d'urgence</h3>
          </div>
          <div className="flex items-center gap-2">
            {!fondsNonConfig && <span className={clsx('text-sm font-bold', textColor)}>{pctFonds.toFixed(1)}%</span>}
            <button onClick={() => ouvrirModal('urgence')}
              className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-dark-card transition-colors" title="Modifier l'objectif">
              <Pencil size={13} className="text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
        {fondsNonConfig ? (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-orange-500">⚠️</span>
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">Revenu de référence non configuré</p>
            </div>
            <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">
              L'objectif est calculé automatiquement : Revenu mensuel × Nombre de mois. Configurez votre revenu pour activer ce suivi.
            </p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[var(--text-muted)]">Épargne précaution actuelle</p>
                <p className="text-lg font-bold text-primary">{formatFCFA(fondsUrgence)}</p>
              </div>
              <button onClick={() => ouvrirModal('urgence')}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-medium transition-all">
                <Pencil size={12} />Configurer
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-[var(--text)]">{formatFCFA(fondsUrgence)}</span>
              <span className="text-[var(--text-muted)]">
                Objectif : {formatFCFA(fondsObjectif)}
                <span className="text-xs ml-1">({nMoisUrgence} × {formatFCFA(revenuRef)})</span>
              </span>
            </div>
            <div className="h-3 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(100, pctFonds)}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-xs text-[var(--text-muted)]">
              <span className={clsx('font-medium', textColor)}>
                {pctFonds < 50 ? '🔴 En dessous de 50%' : pctFonds < 80 ? '🟠 En bonne voie' : '🟢 Objectif atteint'}
              </span>
              <span>Reste : {formatFCFA(Math.max(0, fondsObjectif - fondsUrgence))}</span>
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* 3. STATISTIQUES CUMULÉES                                  */}
      {/* ══════════════════════════════════════════════════════════ */}
      <Separateur emoji="📊" label="Statistiques cumulées — toutes années" />

      {/* KPIs cumulés : Revenus / Dépenses / Solde / Score (sans Épargne) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Revenus cumulés',   val: totalRevenus,  bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',    text: 'text-blue-700 dark:text-blue-400',   icon: TrendingUp },
          { label: 'Dépenses cumulées', val: totalDepenses, bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',        text: 'text-red-600 dark:text-red-400',     icon: TrendingDown },
          { label: 'Solde net cumulé',  val: soldeGlobal,
            bg: soldeGlobal >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
            text: soldeGlobal >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            icon: Wallet },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-4 transition-colors', k.bg)}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              <k.icon size={15} className="opacity-40" />
            </div>
            <p className={clsx('text-xl font-bold', k.text)}>{formatFCFA(k.val)}</p>
          </div>
        ))}
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 transition-colors">
          <p className="text-xs font-medium text-purple-500 dark:text-purple-400 mb-1">Score global</p>
          <p className={clsx('text-2xl font-bold', couleurScore(data?.scoreGlobal ?? score))}>
            {data?.scoreGlobal ?? score}<span className="text-sm text-[var(--text-muted)] font-normal">/20</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {data?.nbMoisScore ? `Moyenne sur ${data.nbMoisScore} mois` : 'Toutes années'}
          </p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* 4. AJOUTS & DÉCAISSEMENTS                                 */}
      {/* ══════════════════════════════════════════════════════════ */}
      <Separateur emoji="🔄" label="Ajouts & Décaissements — cumul" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={28} className="text-green-600 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-green-700 dark:text-green-400 opacity-70">Total ajouté</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-400">{formatFCFA(totalAjouts)}</p>
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={28} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 opacity-70">Total décaissé</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">{formatFCFA(totalDecaissements)}</p>
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* 5. ÉVOLUTION ANNUELLE                                     */}
      {/* ══════════════════════════════════════════════════════════ */}
      {(evolutionAnnuelle ?? []).length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-4">Évolution annuelle</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={evolutionAnnuelle} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="annee" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000000).toFixed(1)+'M'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey="revenus"  name="Revenus"  fill="#1E40AF" radius={[3,3,0,0]} />
              <Bar dataKey="depenses" name="Dépenses" fill="#EF4444" radius={[3,3,0,0]} />
              <Bar dataKey="epargne"  name="Épargne"  fill="#10B981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Onglet Récap ──────────────────────────────────────────────────────────────
function OngletRecap({ moisCourant }: { moisCourant: number }) {
  const anneeActuelle = new Date().getFullYear();
  const [anneeSelect,  setAnneeSelect]  = useState(anneeActuelle);
  const [data,         setData]         = useState<any>(null);
  const [hist,         setHist]         = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [exporting,    setExporting]    = useState<'excel'|'pdf'|null>(null);
  const [anneesDispos, setAnneesDispos] = useState<number[]>([anneeActuelle]);
  const [groupsOpen,   setGroupsOpen]   = useState<Record<string, boolean>>({});
  const [decStats,     setDecStats]     = useState({ totalAjouts: 0, totalDecaissements: 0, soldeNet: 0 });

  useEffect(() => {
    const def: Record<string,boolean> = {};
    ORDRE_TYPES.forEach(t => { def[t] = true; });
    setGroupsOpen(def);
  }, []);

  const toggleGroup  = (type: string) => setGroupsOpen(prev => ({ ...prev, [type]: !prev[type] }));
  const toutDeployer = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = true;  }); setGroupsOpen(n); };
  const toutPlier    = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = false; }); setGroupsOpen(n); };

  useEffect(() => {
    fetch('/api/annees').then(r => r.json()).then(d => {
      if (d.annees?.length) {
        setAnneesDispos(d.annees);
        if (!d.annees.includes(anneeActuelle)) setAnneeSelect(d.annees[d.annees.length - 1]);
      }
    }).catch(() => {});
  }, []);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const promises = Array.from({ length: 12 }, (_, i) =>
        fetch(`/api/budget?annee=${anneeSelect}&mois=${i+1}`).then(r => r.ok ? r.json() : null)
      );
      const results = await Promise.all(promises);
      const cats: any[] = results.find(r => r?.categories?.length)?.categories ?? [];
      const budgetCumul: any[] = [];
      results.forEach(r => {
        if (!r?.budget) return;
        r.budget.forEach((b: any) => {
          const existing = budgetCumul.find(ab => ab.categorieId === b.categorieId);
          if (existing) { existing.montantAnticipe += b.montantAnticipe ?? 0; existing.montantReel += b.montantReel ?? 0; }
          else budgetCumul.push({ ...b, montantAnticipe: b.montantAnticipe ?? 0, montantReel: b.montantReel ?? 0 });
        });
      });
      const histData = [];
      for (let i = 5; i >= 0; i--) {
        let m = moisCourant - i, a = anneeSelect;
        if (m <= 0) { m += 12; a--; }
        const hr = results[m - 1];
        histData.push({
          mois: MOIS_COURTS[m],
          ant:  hr?.budget?.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + b.montantAnticipe, 0) ?? 0,
          reel: hr?.budget?.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + b.montantReel, 0) ?? 0,
        });
      }
      const resDec = await fetch(`/api/decaissements?annee=${anneeSelect}`);
      if (resDec.ok) {
        const decData = await resDec.json();
        const decs = decData.decaissements ?? [];
        const aj  = decs.filter((d: any) => d.typeMouvement === 'ajout').reduce((s: number, d: any) => s + (d.montantTotal ?? 0), 0);
        const ret = decs.filter((d: any) => d.typeMouvement === 'retrait').reduce((s: number, d: any) => s + (d.montantTotal ?? 0), 0);
        setDecStats({ totalAjouts: aj, totalDecaissements: ret, soldeNet: aj - ret });
      }
      setData({ budget: budgetCumul, categories: cats });
      setHist(histData);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [anneeSelect, moisCourant]);

  useEffect(() => { charger(); }, [charger]);

  const exportExcel = async () => {
    if (!window.confirm(`📊 Exporter GestBudget-${anneeSelect}.xlsx ?`)) return;
    setExporting('excel');
    const res = await fetch(`/api/export/excel?annee=${anneeSelect}`);
    if (res.ok) { const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `GestBudget-${anneeSelect}.xlsx`; a.click(); }
    setExporting(null);
  };

  const exportPDF = async () => {
    if (!window.confirm(`📄 Exporter PDF ${anneeSelect} ?`)) return;
    setExporting('pdf');
    const res = await fetch(`/api/export/pdf?annee=${anneeSelect}&mois=${moisCourant}`);
    if (res.ok) { const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `GestBudget-${anneeSelect}-${String(moisCourant).padStart(2,'0')}.pdf`; a.click(); }
    setExporting(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const budget = data?.budget ?? [];
  const cats   = data?.categories ?? [];

  const totType = (type: string, field: 'montantAnticipe'|'montantReel') =>
    budget.filter((b: any) =>
      type==='depense' ? (b.categorie?.type?.startsWith('depense') || b.categorie?.type==='remboursement_dette') :
      b.categorie?.type === type
    ).reduce((s: number, b: any) => s + b[field], 0);

  const revReel = totType('revenu','montantReel');
  const depReel = totType('depense','montantReel');
  const epReel  = budget.filter((b: any) => b.categorie?.type?.startsWith('epargne')).reduce((s: number, b: any) => s + b.montantReel, 0);
  const solde   = revReel - depReel - epReel;

  const fondsCategories = cats.filter((c: any) => c.type === 'epargne_autre');
  const totalFondsRecap = fondsCategories.reduce((s: number, cat: any) => {
    const b = budget.find((b: any) => b.categorieId === cat.id);
    return s + (b?.montantReel ?? 0);
  }, 0);

  const donut = Object.entries(
    budget.filter((b: any) => b.categorie?.type?.startsWith('depense') && b.montantReel > 0)
          .reduce((acc: any, b: any) => { const k = b.categorie?.sousType ?? 'Autre'; acc[k] = (acc[k] ?? 0) + b.montantReel; return acc; }, {})
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5">
      {/* Sélecteur + export */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-muted)]">Année :</span>
          <div className="flex gap-1">
            {anneesDispos.map(a => (
              <button key={a} onClick={() => setAnneeSelect(a)}
                className={clsx('px-3 py-1.5 rounded-xl text-sm font-semibold transition-all',
                  anneeSelect === a ? 'bg-primary text-white' : 'border border-[var(--border)] text-[var(--text-muted)] hover:border-primary hover:text-primary')}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={exporting === 'excel'}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all hover:bg-slate-50 dark:hover:bg-dark-card disabled:opacity-60">
            ⬇ {exporting === 'excel' ? 'Export...' : 'Excel'}
          </button>
          <button onClick={exportPDF} disabled={exporting === 'pdf'}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            📄 {exporting === 'pdf' ? 'Export...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* KPIs annuels — sans Épargne */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: `Revenus ${anneeSelect}`,  val: revReel, cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label: `Dépenses ${anneeSelect}`, val: depReel, cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label: 'Solde annuel', val: solde,
            cls: solde >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 transition-colors', k.cls)}>
            <p className="text-xs font-medium opacity-60">{k.label}</p>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Épargne de Fonctionnement Récap */}
      {fondsCategories.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-[var(--text)]">Épargne de Fonctionnement {anneeSelect}</h3>
            <span className="text-sm font-bold text-primary">{formatFCFA(totalFondsRecap)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {fondsCategories.map((cat: any) => {
              const b = budget.find((b: any) => b.categorieId === cat.id);
              return (
                <div key={cat.id} className="bg-slate-50 dark:bg-dark-card rounded-xl p-3 text-center">
                  <p className="text-xs text-[var(--text-muted)] font-medium truncate">{cat.nom}</p>
                  <p className="text-base font-bold text-primary mt-1">{formatFCFA(b?.montantReel ?? 0)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ajouts & Décaissements de l'année */}
      <Separateur emoji="🔄" label={`Ajouts & Décaissements — ${anneeSelect}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={28} className="text-green-600 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-green-700 dark:text-green-400 opacity-70">Total ajouté</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-400">{formatFCFA(decStats.totalAjouts)}</p>
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={28} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 opacity-70">Total décaissé</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">{formatFCFA(decStats.totalDecaissements)}</p>
          </div>
        </div>

      </div>

      {/* Graphiques */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3">Répartition dépenses</h3>
          {donut.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donut} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={2}>
                  {donut.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatFCFA(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">Aucune dépense cette année</div>
          )}
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3">Dépenses — 6 derniers mois</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hist} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mois" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000).toFixed(0)+'k'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey="ant"  name="Prévision" fill="#DBEAFE" radius={[3,3,0,0]} />
              <Bar dataKey="reel" name="Réel"      fill="#1E40AF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tableau détail */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text)]">Détail — {anneeSelect} (cumul annuel)</h3>
          <div className="flex gap-2">
            <button onClick={toutDeployer} className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-100 dark:hover:bg-dark-card transition">Tout déplier</button>
            <button onClick={toutPlier}    className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-100 dark:hover:bg-dark-card transition">Tout plier</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[540px]" style={{ tableLayout: 'fixed' }}>
            <colgroup><col /><col style={{ width: '150px' }} /><col style={{ width: '150px' }} /><col style={{ width: '150px' }} /></colgroup>
            <thead>
              <tr className="border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Catégorie</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Prévision</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Réel</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Écart</th>
              </tr>
            </thead>
            <tbody>
              {ORDRE_TYPES.map(type => {
                const catsDuType = cats.filter((c: any) => c.type === type);
                if (!catsDuType.length) return null;
                const gAnt  = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantAnticipe ?? 0); }, 0);
                const gReel = catsDuType.reduce((s: number, c: any) => { const b = budget.find((b: any) => b.categorieId === c.id); return s + (b?.montantReel ?? 0); }, 0);
                const gEcar = gReel - gAnt;
                const isOpen = groupsOpen[type] !== false;
                return (
                  <Fragment key={type}>
                    <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)] cursor-pointer hover:bg-slate-100 dark:hover:bg-dark-card/80 transition-colors"
                        onClick={() => toggleGroup(type)}>
                      <td className="px-4 py-2.5 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">
                        <div className="flex items-center gap-2">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gAnt > 0 ? formatFCFA(gAnt) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gReel > 0 ? formatFCFA(gReel) : '—'}</td>
                      <td className={clsx('px-4 py-2.5 text-right text-xs font-bold',
                        gEcar > 0 && type.startsWith('depense') ? 'text-red-500' : gEcar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                        {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                      </td>
                    </tr>
                    {isOpen && catsDuType.map((cat: any) => {
                      const b = budget.find((b: any) => b.categorieId === cat.id);
                      const ant = b?.montantAnticipe ?? 0, reel = b?.montantReel ?? 0, ecar = reel - ant;
                      return (
                        <tr key={cat.id} className="border-t border-[var(--border)] hover:bg-slate-50/40 dark:hover:bg-dark-card/40 transition-colors">
                          <td className="px-4 py-2.5 pl-10 text-[var(--text)] truncate">{cat.nom}</td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{ant  > 0 ? formatFCFA(ant)  : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-[var(--text)]">{reel > 0 ? formatFCFA(reel) : '—'}</td>
                          <td className={clsx('px-4 py-2.5 text-right text-xs font-medium',
                            ecar > 0 && type.startsWith('depense') ? 'text-red-500' : ecar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]')}>
                            {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { mois, annee, setMois, setAnnee } = useMois();
  const [onglet,  setOnglet]  = useState<'global'|'recap'>('global');
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();
  const estMoisCourant      = mois === moisCourantReel && annee === anneeCouranteReelle;

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?annee=${annee}&mois=${mois}`);
    if (!res.ok) { setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { charger(); }, [charger]);

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Tableau de bord</h1>
          <p className="text-[var(--text-muted)] text-sm">
            {onglet === 'global' ? 'Vue globale — toutes années' : 'Récapitulatif annuel'}
          </p>
        </div>
        {!estMoisCourant && (
          <button onClick={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }}
            className="px-3.5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark transition-all flex items-center gap-1.5">
            📅 Mois courant
          </button>
        )}
      </div>
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit">
        {([['global','🌍 Global'],['recap','📋 Récapitulatif']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setOnglet(key)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              onglet === key ? 'bg-white dark:bg-dark-surface text-primary shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
          </button>
        ))}
      </div>
      {onglet === 'global' ? (
        <OngletGlobal moisCourant={mois} anneeCourante={annee} budgetMois={data?.budget ?? []} loadingMois={loading} />
      ) : (
        <OngletRecap moisCourant={mois} />
      )}
    </div>
  );
}
