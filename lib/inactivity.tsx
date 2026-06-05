'use client';

/**
 * InactivityGuard — LAW-GestBudget
 *
 * Corrections appliquees :
 *   P1 — Polling Date + sessionStorage (setTimeout seul est gele sur mobile)
 *   P2 — Page Visibility API : verification immediate au retour d'arriere-plan
 *   P3 — isLoggingOutRef : empeche resetTimer d'annuler un logout en cours
 *   P4 — BroadcastChannel : ecoute SESSION_EXPIRED du service worker
 *        + notifie le SW de l'activite via postMessage (1 fois/min max)
 *   P5 — Evenements touch (touchstart/move/end) + passive:true pour performance mobile
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { signOut } from 'next-auth/react';

// ─── Constantes ──────────────────────────────────────────────────────────────

const TIMEOUT_MS   = 30 * 60 * 1000; // 30 min -> deconnexion
const WARNING_MS   = 25 * 60 * 1000; // 25 min -> avertissement (5 min avant)
const POLL_MS      = 15_000;          // Verification toutes les 15s (fiable mobile)
const SW_NOTIFY_MS = 60_000;          // Notifier le SW au plus 1 fois par minute
const STORAGE_KEY  = 'gb_last_activity';

// P5 — Touch events inclus, passive:true pour ne pas bloquer le scroll
const ACTIVITY_EVENTS: string[] = [
  'mousemove',
  'mousedown',
  'keypress',
  'touchstart',  // Mobile — debut contact
  'touchmove',   // Mobile — glissement
  'touchend',    // Mobile — fin contact
  'scroll',
  'wheel',
  'pointerdown', // Unifie desktop + stylet + touch
  'pointermove',
];

// ─── Composant ───────────────────────────────────────────────────────────────

export function InactivityWarning() {
  const [showWarning, setShowWarning] = useState(false);

  // Refs pour eviter des re-renders inutiles sur chaque interaction
  const warningShownRef = useRef(false);

  // P3 — Empeche resetTimer d'annuler la deconnexion si l'utilisateur
  // interagit avec le bouton "Se deconnecter" (race condition)
  const isLoggingOutRef = useRef(false);

  // P4 — Timestamp du dernier message envoye au service worker (debounce)
  const lastSwNotifyRef = useRef<number>(0);

  // ─── Deconnexion ───────────────────────────────────────────────────────────
  const doLogout = useCallback(() => {
    isLoggingOutRef.current = true;
    sessionStorage.removeItem(STORAGE_KEY);
    signOut({ callbackUrl: '/login' });
  }, []);

  // ─── Notification au service worker (P4) ───────────────────────────────────
  // Debounce : envoie le timestamp d'activite au SW au plus 1 fois par minute
  // pour eviter de flooder le SW sur chaque evenement touchmove/mousemove.
  const notifyServiceWorker = useCallback((ts: number) => {
    if (ts - lastSwNotifyRef.current < SW_NOTIFY_MS) return;
    if (!('serviceWorker' in navigator)) return;

    const controller = navigator.serviceWorker.controller;
    if (!controller) return;

    try {
      controller.postMessage({ type: 'ACTIVITY', ts });
      lastSwNotifyRef.current = ts;
    } catch (_) {
      // SW non disponible — P1+P2 prennent le relai
    }
  }, []);

  // ─── Reset du timer (toute activite utilisateur detectee) ─────────────────
  const resetTimer = useCallback(() => {
    if (isLoggingOutRef.current) return;

    const now = Date.now();
    sessionStorage.setItem(STORAGE_KEY, String(now));

    // P4 — Tenir le service worker informe (debounce 1/min)
    notifyServiceWorker(now);

    // Masquer l'avertissement si l'utilisateur reprend de l'activite
    if (warningShownRef.current) {
      warningShownRef.current = false;
      setShowWarning(false);
    }
  }, [notifyServiceWorker]);

  // ─── Verification de l'inactivite ─────────────────────────────────────────
  const checkInactivity = useCallback(() => {
    if (isLoggingOutRef.current) return;

    const stored       = sessionStorage.getItem(STORAGE_KEY);
    const lastActivity = stored ? Number(stored) : Date.now();
    const elapsed      = Date.now() - lastActivity;

    if (elapsed >= TIMEOUT_MS) {
      doLogout();
    } else if (elapsed >= WARNING_MS && !warningShownRef.current) {
      warningShownRef.current = true;
      setShowWarning(true);
    }
  }, [doLogout]);

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
  }, []);

  // ─── P1 — Polling toutes les 15s ───────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(checkInactivity, POLL_MS);
    return () => clearInterval(id);
  }, [checkInactivity]);

  // ─── P2 — Page Visibility API ──────────────────────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkInactivity();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [checkInactivity]);

  // ─── P4 — BroadcastChannel : ecoute SESSION_EXPIRED du service worker ──────
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;

    const channel = new BroadcastChannel('gb_session');
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'SESSION_EXPIRED') doLogout();
    };
    return () => channel.close();
  }, [doLogout]);

  // ─── P5 — Evenements d'activite (touch inclus) ────────────────────────────
  useEffect(() => {
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, resetTimer, { passive: true })
    );
    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, resetTimer)
      );
    };
  }, [resetTimer]);

  // ─── Modal d'avertissement ─────────────────────────────────────────────────
  if (!showWarning) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactivity-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full border border-orange-200 dark:border-orange-800">

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-orange-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h3
              id="inactivity-title"
              className="font-semibold text-gray-900 dark:text-white text-sm"
            >
              Session bientot expiree
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Inactivite detectee
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
          Vous serez deconnecte dans{' '}
          <span className="font-bold text-orange-500">moins de 5 minutes</span>{' '}
          pour raison de securite. Cliquez sur{' '}
          <span className="font-medium">Continuer</span> pour rester connecte.
        </p>

        <div className="flex gap-3">
          <button
            onClick={doLogout}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Se deconnecter
          </button>
          <button
            onClick={resetTimer}
            autoFocus
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium transition-colors"
          >
            Continuer
          </button>
        </div>

      </div>
    </div>
  );
}
