'use client';

import { Wallet, CalendarClock, Shield, TrendingUp, AlertTriangle } from 'lucide-react';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';

// ─────────────────────────────────────────────────────────────────────────────
// S7 — F4 « Reste a vivre » + F6 etendu « Autonomie reelle »
//
// F4 : transforme un budget mensuel abstrait en decision d'aujourd'hui.
//      disponible = revenus - depenses - epargne, divise par les jours restants.
//
// F6 : la carte « Fonds urgence » existante mesure l'epargne contre le REVENU
//      de reference. Ici on mesure l'autonomie reelle : combien de mois
//      l'epargne couvre-t-elle des DEPENSES observees ?
//
// Projection : rythme a date x jours du mois. Peu fiable en debut de mois,
// d'ou l'indice de confiance affiche (evite les fausses alertes de decouvert).
// ─────────────────────────────────────────────────────────────────────────────

interface PilotageCardsProps {
  revenusReel:        number;
  depensesReel:       number;
  epargneReel:        number;
  solde:              number;
  epargnePrecaution:  number;   // total banques
  totalFonds:         number;   // total fonds de fonctionnement
  depensesHistorique: number[]; // sparklines.depenses (6 mois, dernier = mois courant partiel)
  moisCourant:        number;
  anneeCourante:      number;
}

export default function PilotageCards({
  revenusReel,
  depensesReel,
  epargneReel,
  solde,
  epargnePrecaution,
  totalFonds,
  depensesHistorique,
  moisCourant,
  anneeCourante,
}: PilotageCardsProps) {

  const today        = new Date();
  const estMoisReel  = today.getMonth() + 1 === moisCourant && today.getFullYear() === anneeCourante;
  const joursDansMois = new Date(anneeCourante, moisCourant, 0).getDate();
  const jourActuel   = estMoisReel ? today.getDate() : joursDansMois;
  const joursRestants = Math.max(1, joursDansMois - jourActuel + 1);

  // ── F4 : reste a vivre ────────────────────────────────────────────────────
  const resteAVivre = solde;
  const parJour     = Math.floor(resteAVivre / joursRestants);

  // ── Projection fin de mois (rythme observe) ───────────────────────────────
  const rythmeJournalier = jourActuel > 0 ? depensesReel / jourActuel : 0;
  const projectionDep    = Math.round(rythmeJournalier * joursDansMois);
  const projectionSolde  = revenusReel - epargneReel - projectionDep;
  // Avant J-10 le rythme est trop bruite pour conclure
  const confiance: 'faible' | 'moyenne' | 'bonne' =
    jourActuel < 10 ? 'faible' : jourActuel < 20 ? 'moyenne' : 'bonne';

  // ── F6 : autonomie reelle ─────────────────────────────────────────────────
  // On exclut le dernier point (mois courant, partiel) et les mois a zero.
  const moisComplets = depensesHistorique.slice(0, -1).filter(v => v > 0);
  const moyenneDep   = moisComplets.length > 0
    ? moisComplets.reduce((s, v) => s + v, 0) / moisComplets.length
    : 0;
  const epargneTotale = epargnePrecaution + totalFonds;
  const moisCouverts  = moyenneDep > 0 ? epargneTotale / moyenneDep : 0;

  const couleurAutonomie =
    moisCouverts >= 6 ? 'text-green-700 dark:text-green-400'
    : moisCouverts >= 3 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';
  const bgAutonomie =
    moisCouverts >= 6 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : moisCouverts >= 3 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';

  const rienASignaler = revenusReel === 0 && depensesReel === 0;
  if (rienASignaler && moyenneDep === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

      {/* ── F4 : Reste a vivre ── */}
      <div className={clsx('rounded-2xl border p-4 flex flex-col gap-1 transition-colors',
        resteAVivre >= 0
          ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800')}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium opacity-60">Reste a vivre</p>
          <Wallet size={15} className="opacity-40"/>
        </div>
        {estMoisReel ? (
          <>
            <p className={clsx('text-2xl font-bold leading-tight',
              parJour >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-600 dark:text-red-400')}>
              {formatFCFA(Math.abs(parJour))}
              <span className="text-sm font-normal text-[var(--text-muted)]"> / jour</span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {formatFCFA(resteAVivre)} sur {joursRestants} jour{joursRestants > 1 ? 's' : ''} restant{joursRestants > 1 ? 's' : ''}
            </p>
            {parJour < 0 && (
              <p className="text-[11px] text-red-600 font-semibold mt-0.5">
                Budget deja depasse ce mois
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-2xl font-bold leading-tight text-[var(--text-muted)]">
              {formatFCFA(resteAVivre)}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Solde du mois — indicateur journalier disponible sur le mois courant
            </p>
          </>
        )}
      </div>

      {/* ── Projection fin de mois ── */}
      <div className={clsx('rounded-2xl border p-4 flex flex-col gap-1 transition-colors',
        projectionSolde >= 0
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
          : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800')}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium opacity-60">Projection fin de mois</p>
          <CalendarClock size={15} className="opacity-40"/>
        </div>
        {estMoisReel && depensesReel > 0 ? (
          <>
            <p className={clsx('text-2xl font-bold leading-tight',
              projectionSolde >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400')}>
              {formatFCFA(projectionSolde)}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Depenses projetees : {formatFCFA(projectionDep)}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                confiance === 'bonne'   ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : confiance === 'moyenne' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400')}>
                Fiabilite {confiance}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">J{jourActuel}/{joursDansMois}</span>
            </div>
            {projectionSolde < 0 && confiance !== 'faible' && (
              <p className="flex items-center gap-1 text-[11px] text-orange-600 font-semibold mt-0.5">
                <AlertTriangle size={11}/> Risque de decouvert au rythme actuel
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            {estMoisReel ? 'Saisissez des depenses pour activer la projection.' : 'Disponible sur le mois courant.'}
          </p>
        )}
      </div>

      {/* ── F6 : Autonomie reelle ── */}
      <div className={clsx('rounded-2xl border p-4 flex flex-col gap-1 transition-colors', bgAutonomie)}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium opacity-60">Autonomie</p>
          <Shield size={15} className="opacity-40"/>
        </div>
        {moyenneDep > 0 ? (
          <>
            <p className={clsx('text-2xl font-bold leading-tight', couleurAutonomie)}>
              {moisCouverts.toFixed(1)}
              <span className="text-sm font-normal text-[var(--text-muted)]"> mois</span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {formatFCFA(epargneTotale)} face a {formatFCFA(Math.round(moyenneDep))}/mois
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              Moyenne sur {moisComplets.length} mois complet{moisComplets.length > 1 ? 's' : ''}
            </p>
          </>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Historique insuffisant pour calculer l&apos;autonomie.
          </p>
        )}
      </div>

    </div>
  );
}
