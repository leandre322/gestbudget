'use client';
import { clsx } from 'clsx';
import { MOIS_LABELS } from '@/types';

interface Props {
  mois: number;
  annee: number;
  onMoisCourant: () => void;
}

export default function BandeauMoisAnterieur({ mois, annee, onMoisCourant }: Props) {
  const moisCourant    = new Date().getMonth() + 1;
  const anneeCourante  = new Date().getFullYear();
  const estAnterieur   = annee < anneeCourante || (annee === anneeCourante && mois < moisCourant);
  const estFutur       = annee > anneeCourante || (annee === anneeCourante && mois > moisCourant);

  if (!estAnterieur && !estFutur) return null;

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