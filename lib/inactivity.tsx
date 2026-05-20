'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { signOut } from 'next-auth/react';

const TIMEOUT_MS    = 15 * 60 * 1000; // 15 minutes
const WARNING_MS    = 2  * 60 * 1000; // Avertissement 2 min avant
const EVENTS        = ['mousedown','mousemove','keydown','scroll','touchstart','click'];

export function useInactivityTimer() {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const timerRef    = useRef<NodeJS.Timeout>();
  const warningRef  = useRef<NodeJS.Timeout>();
  const countdownRef= useRef<NodeJS.Timeout>();

  const clearAll = useCallback(() => {
    clearTimeout(timerRef.current);
    clearTimeout(warningRef.current);
    clearInterval(countdownRef.current);
  }, []);

  const resetTimer = useCallback(() => {
    clearAll();
    setShowWarning(false);

    // Warning après 13 minutes
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
      setSecondsLeft(120);
      // Compte à rebours
      countdownRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) { clearInterval(countdownRef.current); return 0; }
          return s - 1;
        });
      }, 1000);
    }, TIMEOUT_MS - WARNING_MS);

    // Déconnexion après 15 minutes
    timerRef.current = setTimeout(() => {
      signOut({ callbackUrl: '/login' });
    }, TIMEOUT_MS);
  }, [clearAll]);

  const stayConnected = useCallback(() => {
    setShowWarning(false);
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    resetTimer();
    EVENTS.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      clearAll();
      EVENTS.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [resetTimer, clearAll]);

  return { showWarning, secondsLeft, stayConnected };
}

// Composant popup d'avertissement
export function InactivityWarning() {
  const { showWarning, secondsLeft, stayConnected } = useInactivityTimer();

  if (!showWarning) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const pct  = (secondsLeft / 120) * 100;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center border border-[var(--border)]">
        {/* Icône */}
        <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">⏱️</span>
        </div>

        <h3 className="text-lg font-bold text-[var(--text)] mb-2">
          Session expirée bientôt
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Vous serez déconnecté automatiquement dans
        </p>

        {/* Compte à rebours */}
        <div className="text-4xl font-bold text-amber-500 mb-4">
          {mins > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : `${secs}s`}
        </div>

        {/* Barre de progression */}
        <div className="h-2 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-amber-400 rounded-full transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex-1 border border-[var(--border)] text-[var(--text-muted)] rounded-xl py-2.5 text-sm font-medium hover:bg-slate-50 dark:hover:bg-dark-card transition-all"
          >
            Se déconnecter
          </button>
          <button
            onClick={stayConnected}
            className="flex-1 bg-primary hover:bg-primary-dark text-white rounded-xl py-2.5 text-sm font-bold transition-all"
          >
            Rester connecté
          </button>
        </div>
      </div>
    </div>
  );
}
