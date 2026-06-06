'use client';

import { useEffect } from 'react';
import { clsx } from 'clsx';
import { ArrowRightLeft } from 'lucide-react';
import { formatFCFA } from '@/types';

interface EnveloppeCardProps {
  id:               string;
  nom:              string;
  montantReference: number;
  depense:          number;
  mois:             number;
  annee:            number;
  onGlissement?:    (id: string, nom: string, disponible: number) => void;
}

async function sendPushNotif(title: string, body: string) {
  try {
    await fetch('/api/push/notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, body, url: '/suivi' }),
    });
  } catch {}
}

export default function EnveloppeCard({
  id, nom, montantReference, depense, mois, annee, onGlissement,
}: EnveloppeCardProps) {
  const pct        = montantReference > 0 ? (depense / montantReference) * 100 : 0;
  const restant    = montantReference - depense;
  const restantPct = montantReference > 0 ? (restant / montantReference) * 100 : 100;
  const pctRound   = Math.round(Math.min(pct, 200));

  const isOver    = pct >= 100;
  const isWarning = restantPct < 20 && !isOver; // restant < 20%

  const barColor = isOver
    ? 'bg-red-500'
    : pct >= 80
      ? 'bg-orange-400'
      : 'bg-emerald-500';

  // Clés localStorage par cat + mois + année → reset automatique chaque mois
  const key80  = `env-80-${id}-${annee}-${mois}`;
  const key100 = `env-100-${id}-${annee}-${mois}`;

  useEffect(() => {
    if (typeof window === 'undefined' || montantReference === 0) return;

    if (pct >= 100 && !localStorage.getItem(key100)) {
      localStorage.setItem(key100, '1');
      sendPushNotif(
        `⛔ ${nom} — Dépassement`,
        `Budget de ${formatFCFA(montantReference)} dépassé de ${formatFCFA(Math.abs(restant))}.`,
      );
    } else if (pct >= 80 && !localStorage.getItem(key80)) {
      localStorage.setItem(key80, '1');
      sendPushNotif(
        `⚠️ ${nom} — 80 % consommé`,
        `Il reste ${formatFCFA(Math.max(0, restant))} sur ${formatFCFA(montantReference)}.`,
      );
    }
  }, [pct, key80, key100]);

  return (
    <div
      className={clsx(
        'relative rounded-xl border p-3 transition-all duration-300',
        isOver
          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
          : isWarning
            ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10'
            : 'border-[var(--border)] bg-[var(--card)]',
      )}
    >
      {/* Nom + bouton glissement */}
      <div className="flex items-center justify-between gap-1 mb-2">
        <span className="text-xs font-semibold text-[var(--text)] truncate flex-1">{nom}</span>
        {onGlissement && montantReference > 0 && (
          <button
            onClick={() => onGlissement(id, nom, Math.max(0, restant))}
            title="Glisser du budget vers une autre enveloppe"
            className="flex-shrink-0 p-1 rounded-lg text-[var(--text-muted)] hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <ArrowRightLeft size={11} />
          </button>
        )}
      </div>

      {/* Barre de progression */}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-1.5">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-700',
            barColor,
            isWarning && 'animate-pulse',
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* % + montants */}
      <div className="flex items-center justify-between text-[10px]">
        <span className={clsx(
          'font-bold',
          isOver ? 'text-red-500' : isWarning ? 'text-orange-500' : 'text-[var(--text-muted)]',
        )}>
          {pctRound}%
        </span>
        <span className="text-[var(--text-muted)] tabular-nums">
          {formatFCFA(depense)} / {formatFCFA(montantReference)}
        </span>
      </div>

      {/* Restant */}
      <p className={clsx(
        'text-[10px] text-right mt-0.5 font-medium',
        isOver ? 'text-red-500' : isWarning ? 'text-orange-500' : 'text-[var(--text-muted)]',
      )}>
        {isOver
          ? `+${formatFCFA(Math.abs(restant))} dépassé`
          : `${formatFCFA(Math.max(0, restant))} restant`}
      </p>
    </div>
  );
}
