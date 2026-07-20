'use client';

import { createContext, useContext } from 'react';

// ── MoisContext ──────────────────────────────────────────────────────────────
export interface MoisCtx {
  mois: number;
  annee: number;
  setMois: (m: number) => void;
  setAnnee: (a: number) => void;
}

export const MoisContext = createContext<MoisCtx>({
  mois: 1,
  annee: 2026,
  setMois: () => {},
  setAnnee: () => {},
});

export const useMois = () => useContext(MoisContext);

// ── LockContext ──────────────────────────────────────────────────────────────
export interface LockCtx {
  isLocked: boolean;
  unlockToken: string | null;
  lock: () => void;
  openUnlockModal: () => void;
}

export const LockContext = createContext<LockCtx>({
  isLocked: true,
  unlockToken: null,
  lock: () => {},
  openUnlockModal: () => {},
});

export const useLock = () => useContext(LockContext);
