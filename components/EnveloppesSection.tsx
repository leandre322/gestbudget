'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import EnveloppeCard from './EnveloppeCard';
import GlissementModal from './GlissementModal';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface EnveloppeData {
  id:               string;
  nom:              string;
  type:             string;
  montantReference: number;
  montantReel:      number;
  montantAnticipe:  number;
  enveloppeActive:  boolean;
}

interface GlissementState {
  fromId:     string;
  fromNom:    string;
  disponible: number;
}

interface Props {
  mois:      number;
  annee:     number;
  readOnly?: boolean;
}

export default function EnveloppesSection({ mois, annee, readOnly = false }: Props) {
  const { data, isLoading, mutate } = useSWR(
    mois && annee ? `/api/enveloppes?mois=${mois}&annee=${annee}` : null,
    fetcher,
    { refreshInterval: 60_000, dedupingInterval: 30_000 },
  );

  const [glissement, setGlissement] = useState<GlissementState | null>(null);

  const enveloppes: EnveloppeData[] = data?.enveloppes ?? [];
  const actives = enveloppes.filter(e => e.enveloppeActive && e.montantReference > 0);

  // Demander la permission push au premier montage (silencieux si déjà accordée)
  useEffect(() => {
    if (readOnly) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [readOnly]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 animate-pulse">
        <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!actives.length) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-primary flex-shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--text)]">Enveloppes budgétaires</h2>
          <span className="text-[10px] text-[var(--text-muted)] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full font-medium">
            {actives.length}
          </span>
        </div>
        <button
          onClick={() => mutate()}
          title="Rafraîchir"
          className="text-[var(--text-muted)] hover:text-primary transition-colors p-1 rounded-lg hover:bg-primary/10"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Grille de cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {actives.map(env => (
          <EnveloppeCard
            key={env.id}
            id={env.id}
            nom={env.nom}
            montantReference={env.montantReference}
            depense={env.montantReel}
            mois={mois}
            annee={annee}
            onGlissement={
              readOnly
                ? undefined
                : (id, nom, disponible) => setGlissement({ fromId: id, fromNom: nom, disponible })
            }
          />
        ))}
      </div>

      {/* Modale glissement */}
      {glissement && !readOnly && (
        <GlissementModal
          fromId={glissement.fromId}
          fromNom={glissement.fromNom}
          disponible={glissement.disponible}
          enveloppes={enveloppes}
          onClose={() => setGlissement(null)}
          onSuccess={() => { mutate(); setGlissement(null); }}
        />
      )}
    </div>
  );
}
