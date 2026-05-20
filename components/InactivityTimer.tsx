'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { useSession } from 'next-auth/react';

const TIMEOUT_MS   = 15 * 60 * 1000; // 15 minutes
const WARNING_MS   = 13 * 60 * 1000; // Avertir à 13min (2min avant)
const EVENTS = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

export default function InactivityTimer() {
  const { data: session } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const warningRef = useRef<NodeJS.Timeout>();
  const countRef   = useRef<NodeJS.Timeout>();

  const reset = () => {
    if (!session) return;
    setShowWarning(false);
    setSecondsLeft(120);
    clearTimeout(timeoutRef.current);
    clearTimeout(warningRef.current);
    clearInterval(countRef.current);

    // Déconnexion à 15min
    timeoutRef.current = setTimeout(() => {
      signOut({ callbackUrl: '/login' });
    }, TIMEOUT_MS);

    // Avertissement à 13min
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
      setSecondsLeft(120);
      // Compte à rebours 120→0
      countRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            clearInterval(countRef.current);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }, WARNING_MS);
  };

  useEffect(() => {
    if (!session) return;
    reset();
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, reset));
      clearTimeout(timeoutRef.current);
      clearTimeout(warningRef.current);
      clearInterval(countRef.current);
    };
  }, [session]);

  if (!showWarning) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-[var(--border)]">
        {/* Icône */}
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⏰</span>
        </div>

        <h2 className="text-lg font-bold text-[var(--text)] text-center mb-2">
          Session sur le point d'expirer
        </h2>
        <p className="text-sm text-[var(--text-muted)] text-center mb-4">
          Vous serez déconnecté dans
        </p>

        {/* Compte à rebours */}
        <div className="text-center mb-5">
          <span className="text-4xl font-bold text-amber-500">
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </span>
        </div>

        {/* Barre de progression */}
        <div className="h-1.5 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden mb-5">
          <div
            className="h-full bg-amber-400 rounded-full transition-all duration-1000"
            style={{ width: `${(secondsLeft / 120) * 100}%` }}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex-1 bg-primary hover:bg-primary-dark text-white font-medium rounded-xl py-2.5 transition-all"
          >
            Rester connecté
          </button>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex-1 border border-[var(--border)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] font-medium rounded-xl py-2.5 transition-all"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
