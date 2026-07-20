'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, Loader2, Send, Check, X } from 'lucide-react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output  = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

type PushState = 'checking' | 'unsupported' | 'unsubscribed' | 'subscribed' | 'denied';
type TestStatus = 'idle' | 'sending' | 'sent' | 'error';

export function PushSubscribeButton() {
  const [state, setState] = useState<PushState>('checking');
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');

  useEffect(() => {
    // Navigateur incompatible → pas de bouton
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    // FIX : timeout 4s — évite le skeleton infini si le SW tarde à s'activer
    // (cas fréquent au premier chargement après déploiement)
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      setState('unsubscribed'); // on affiche le bouton même si le SW est lent
    }, 4000);

    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => {
        if (!timedOut) setState(sub ? 'subscribed' : 'unsubscribed');
      })
      .catch(() => {
        if (!timedOut) setState('unsubscribed');
      })
      .finally(() => clearTimeout(timer));
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') { setState('denied'); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      const res = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub),
      });

      if (res.ok) setState('subscribed');
    } catch (err) {
      console.error('[push:subscribe]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/api/push/subscribe', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setState('unsubscribed');
      setTestStatus('idle'); // reset du test si on se désabonne
    } catch (err) {
      console.error('[push:unsubscribe]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTestStatus('sending');
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (res.ok) {
        setTestStatus('sent');
      } else {
        setTestStatus('error');
      }
    } catch (err) {
      console.error('[push:test]', err);
      setTestStatus('error');
    } finally {
      // Repasse à l'état neutre après 3s pour pouvoir retester
      setTimeout(() => setTestStatus('idle'), 3000);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────

  if (state === 'checking') {
    return <div className="h-10 w-52 animate-pulse rounded-lg bg-gray-800" />;
  }

  if (state === 'unsupported') {
    return (
      <p className="text-xs text-gray-500">
        Notifications non supportées sur ce navigateur.{' '}
        Sur Safari iOS : ajoutez l'app à l'écran d'accueil.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={state === 'subscribed' ? handleUnsubscribe : handleSubscribe}
        disabled={loading || state === 'denied'}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
          transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
          state === 'subscribed'
            ? 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
        }`}
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : state === 'subscribed'
            ? <BellOff className="w-4 h-4" />
            : <Bell    className="w-4 h-4" />
        }
        {state === 'subscribed'
          ? 'Désactiver les notifications'
          : 'Activer les notifications'}
      </button>

      {/* ── Bouton test : visible uniquement si abonné ── */}
      {state === 'subscribed' && (
        <button
          onClick={handleTest}
          disabled={testStatus === 'sending'}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            transition-all disabled:opacity-50 disabled:cursor-not-allowed border ${
            testStatus === 'sent'
              ? 'bg-green-900/30 border-green-700 text-green-400'
              : testStatus === 'error'
                ? 'bg-red-900/30 border-red-700 text-red-400'
                : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'
          }`}
        >
          {testStatus === 'sending'
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : testStatus === 'sent'
              ? <Check className="w-4 h-4" />
              : testStatus === 'error'
                ? <X className="w-4 h-4" />
                : <Send className="w-4 h-4" />
          }
          {testStatus === 'sending'
            ? 'Envoi...'
            : testStatus === 'sent'
              ? 'Notification envoyée !'
              : testStatus === 'error'
                ? 'Échec — réessayer'
                : 'Envoyer une notification test'}
        </button>
      )}

      {state === 'subscribed' && (
        <p className="text-xs text-gray-500">
          Bilan hebdomadaire chaque lundi à 8h.
        </p>
      )}
      {state === 'denied' && (
        <p className="text-xs text-red-400">
          Notifications bloquées. Autorisez-les dans les paramètres du navigateur.
        </p>
      )}
    </div>
  );
}
