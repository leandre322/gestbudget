'use client';

/**
 * InactivityGuard — LAW-GestBudget
 *
 * Historique
 *   P1 — Polling Date + stockage (setTimeout seul est gele sur mobile)
 *   P2 — Page Visibility API : verification immediate au retour d arriere-plan
 *   P3 — isLoggingOutRef : empeche resetTimer d annuler un logout en cours
 *   P4 — BroadcastChannel + notification du service worker   <- RETIRE en S23
 *   P5 — Evenements touch (touchstart/move/end) + passive:true
 *
 * ───────────────────────────────────────────────────────────────────────────
 * S23 / P130 — notifyServiceWorker() et le gardien SW sont supprimes.
 *   Le controle d inactivite est desormais assure ICI et nulle part ailleurs.
 *   Une seule horloge, un seul decideur. Voir worker/index.js pour le detail
 *   du mecanisme de deconnexion qui est retire.
 *
 * S23 / P149 — sessionStorage -> localStorage.
 *   sessionStorage est CLOISONNE PAR CONTEXTE. Chaque onglet, et la PWA
 *   installee, possedait son propre compteur. Un contexte laisse ouvert et
 *   oublie ne recevait aucun evenement d activite : son setInterval
 *   continuait de tourner en arriere-plan et appelait signOut() au bout de
 *   30 minutes. Or signOut() detruit le cookie pour TOUTE l origine — donc
 *   aussi pour le contexte dans lequel l utilisateur travaillait.
 *   localStorage est partage par tous les contextes de l origine : le
 *   dernier contexte ACTIF fait desormais foi, au lieu du plus oublie.
 *
 * S23 / P150 — le retour anticipe silencieux sur `controller === null`
 *   disparait avec notifyServiceWorker().
 *
 * S23 / P151 — `keypress` remplace par `keydown`.
 *   `keypress` est deprecie et ne se declenche PAS pour Tab, les fleches,
 *   Retour arriere, Suppr et Entree. Un utilisateur remplissant la grille
 *   budgetaire au clavier ne produisait aucun evenement d activite hormis
 *   un mousemove fortuit. `keydown` est un sur-ensemble strict.
 *
 * S23 / I48 — ecriture throttlee a 5 s.
 *   `mousemove` et `pointermove` declenchaient chacun un setItem synchrone
 *   sur le fil principal, plusieurs centaines de fois par seconde. Contre un
 *   delai de 30 minutes, un retard de 5 s sur l horodatage est sans effet.
 *
 * NOTE DE PERIMETRE : ce delai de 30 minutes est purement CLIENT. Le serveur
 * maintient la session 24 h (session.maxAge). Ce mecanisme protege un poste
 * laisse sans surveillance ; il n oppose rien a un cookie vole.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { signOut } from 'next-auth/react';

// ─── Constantes ──────────────────────────────────────────────────────────────

const TIMEOUT_MS   = 30 * 60 * 1000; // 30 min -> deconnexion
const WARNING_MS   = 25 * 60 * 1000; // 25 min -> avertissement (5 min avant)
const POLL_MS      = 15_000;         // Verification toutes les 15 s (fiable mobile)
const ECRITURE_MS  = 5_000;          // I48 — throttle des ecritures localStorage
const STORAGE_KEY  = 'gb_last_activity';
const CANAL        = 'gb_session';

// P151 — keydown au lieu de keypress (deprecie, ignore les touches de navigation)
const ACTIVITY_EVENTS: string[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'touchmove',
  'touchend',
  'scroll',
  'wheel',
  'pointerdown',
  'pointermove',
];

// ─── Acces stockage, tolerants (Safari navigation privee, quota) ─────────────

function lireActivite(): number | null {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (!brut) return null;
    const n = Number(brut);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function ecrireActivite(ts: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // Stockage indisponible : le composant reste inoffensif (voir checkInactivite).
  }
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function InactivityWarning() {
  const [showWarning, setShowWarning] = useState(false);

  const warningShownRef     = useRef(false);
  const isLoggingOutRef     = useRef(false);
  const derniereEcritureRef = useRef(0);

  // ─── Deconnexion ───────────────────────────────────────────────────────────
  // `diffuser` distingue la deconnexion DECIDEE ici (a propager aux autres
  // contextes) de celle RECUE d un autre contexte (a ne pas renvoyer, sinon
  // les contextes se relancent le message en boucle).
  const terminer = useCallback((diffuser: boolean) => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    try { localStorage.removeItem(STORAGE_KEY); } catch {}

    if (diffuser && typeof BroadcastChannel !== 'undefined') {
      try {
        const canal = new BroadcastChannel(CANAL);
        canal.postMessage({ type: 'SESSION_EXPIRED' });
        canal.close();
      } catch {
        // Canal indisponible : les autres contextes verront le 401 serveur.
      }
    }

    signOut({ callbackUrl: '/login' });
  }, []);

  // ─── Reset du timer (toute activite utilisateur detectee) ─────────────────
  const resetTimer = useCallback(() => {
    if (isLoggingOutRef.current) return;

    const now = Date.now();

    // Reprise d activite alors que l avertissement est affiche : on ecrit
    // immediatement, sans attendre le throttle, et on masque la modale.
    if (warningShownRef.current) {
      warningShownRef.current = false;
      setShowWarning(false);
      derniereEcritureRef.current = now;
      ecrireActivite(now);
      return;
    }

    // I48 — au plus une ecriture toutes les ECRITURE_MS.
    if (now - derniereEcritureRef.current < ECRITURE_MS) return;
    derniereEcritureRef.current = now;
    ecrireActivite(now);
  }, []);

  // ─── Verification de l inactivite ─────────────────────────────────────────
  const checkInactivite = useCallback(() => {
    if (isLoggingOutRef.current) return;

    const derniere = lireActivite();

    // Aucune valeur exploitable (premiere visite, stockage indisponible,
    // contenu corrompu) : on reamorce au lieu de deconnecter. Une absence
    // d information n est pas une preuve d inactivite.
    if (derniere === null) {
      const now = Date.now();
      derniereEcritureRef.current = now;
      ecrireActivite(now);
      return;
    }

    const ecoule = Date.now() - derniere;

    if (ecoule >= TIMEOUT_MS) {
      terminer(true);
      return;
    }

    if (ecoule >= WARNING_MS) {
      if (!warningShownRef.current) {
        warningShownRef.current = true;
        setShowWarning(true);
      }
      return;
    }

    // P149 — l avertissement doit pouvoir etre RETIRE par l activite d un
    // AUTRE contexte. L ancienne version ne le masquait que depuis
    // resetTimer, donc jamais dans un onglet inactif : la modale y restait
    // affichee indefiniment alors que la session etait maintenue ailleurs.
    if (warningShownRef.current) {
      warningShownRef.current = false;
      setShowWarning(false);
    }
  }, [terminer]);

  // ─── Init : un montage est une activite ────────────────────────────────────
  // Ecriture INCONDITIONNELLE, contrairement a la version sessionStorage qui
  // n ecrivait qu en l absence de valeur. localStorage survit a la fermeture
  // du navigateur : sans ce reamorcage, la premiere verification apres une
  // reouverture le lendemain deconnecterait aussitot. Un montage suppose une
  // navigation, donc une action de l utilisateur.
  useEffect(() => {
    const now = Date.now();
    derniereEcritureRef.current = now;
    ecrireActivite(now);
  }, []);

  // ─── P1 — Polling toutes les 15 s ──────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(checkInactivite, POLL_MS);
    return () => clearInterval(id);
  }, [checkInactivite]);

  // ─── P2 — Page Visibility API ──────────────────────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkInactivite();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [checkInactivite]);

  // ─── BroadcastChannel — propagation d une deconnexion entre contextes ──────
  // Le canal ne transporte plus que les deconnexions DECIDEES par un contexte
  // client. Le service worker n y publie plus rien (P130).
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;

    const canal = new BroadcastChannel(CANAL);
    canal.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'SESSION_EXPIRED') terminer(false);
    };
    return () => canal.close();
  }, [terminer]);

  // ─── P5 — Evenements d activite (touch inclus) ────────────────────────────
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

  // ─── Modal d avertissement ─────────────────────────────────────────────────
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
            onClick={() => terminer(true)}
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