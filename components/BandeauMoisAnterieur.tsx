'use client';
import { useState } from 'react';
import { clsx } from 'clsx';
import { MOIS_LABELS } from '@/types';

interface Props {
  mois: number;
  annee: number;
  onMoisCourant: () => void;
}

export default function BandeauMoisAnterieur({ mois, annee, onMoisCourant }: Props) {
  const now            = new Date();
  const moisCourant    = now.getMonth() + 1;
  const anneeCourante  = now.getFullYear();
  const [confirme,     setConfirme] = useState(false);

  // Calculer l'écart en mois
  const ecartMois = (annee - anneeCourante) * 12 + (mois - moisCourant);
  const estAnterieur = ecartMois < 0;
  const estFutur     = ecartMois > 0;
  const estTropLoin  = ecartMois > 2; // Plus de 2 mois en avance

  if (!estAnterieur && !estFutur) return null;

  // Si futur > 2 mois et pas encore confirmé
  if (estTropLoin && !confirme) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl px-4 py-3 space-y-3">
        <div className="flex items-start gap-2">
          <span className="text-lg flex-shrink-0">🔴</span>
          <div>
            <p className="font-bold text-red-700 dark:text-red-400 text-sm">
              Attention — {ecartMois} mois d'avance sur le mois courant
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
              Vous vous apprêtez à créer des données pour{' '}
              <strong>{MOIS_LABELS[mois]} {annee}</strong> alors que nous sommes en{' '}
              <strong>{MOIS_LABELS[moisCourant]} {anneeCourante}</strong>.
              Cela représente <strong>{ecartMois} mois</strong> d'avance.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onMoisCourant}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-600 text-white transition-all">
            ← Revenir à {MOIS_LABELS[moisCourant]} {anneeCourante}
          </button>
          <button
            onClick={() => setConfirme(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all">
            Continuer quand même →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(
      'rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm',
      estAnterieur
        ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
        : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
    )}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{estAnterieur ? '⚠️' : '🔮'}</span>
        <div>
          <p className={clsx('font-semibold text-sm',
            estAnterieur ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400')}>
            {estAnterieur
              ? `Vous consultez ${MOIS_LABELS[mois]} ${annee} — mois passé`
              : `Vous consultez ${MOIS_LABELS[mois]} ${annee} — mois futur`
            }
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {estAnterieur
              ? 'Les modifications affecteront des données historiques.'
              : 'Les modifications affecteront des données futures.'}
          </p>
        </div>
      </div>
      <button
        onClick={onMoisCourant}
        className={clsx(
          'px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all flex-shrink-0',
          estAnterieur ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-500 hover:bg-blue-600'
        )}>
        📅 Mois courant
      </button>
    </div>
  );
}