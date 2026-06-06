'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';

// Convertit la clé VAPID base64url → Uint8Array (requis par pushManager.subscribe)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output  = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

type PushState = 'checking' | 'unsupported' | 'unsubscribed' | 'subscribed' | 'denied';

export function PushSubscribeButton() {
  const [state, setstate] = useState<PushState>('checking');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Safari iOS 16.4+ : uniquement si site ajouté à l'écran d'accueil
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setstate('unsupported');
      return;
    }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setstate(sub ? 'subscribed' : 'unsubscribed'))
      .catch(() => setstate('unsubscribed'));
  }, []);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') { setstate('denied'); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      const res = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub),
      });

      if (res.ok) setstate('subscribed');
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
      setstate('unsubscribed');
    } catch (err) {
      console.error('[push:unsubscribe]', err);
    } finally {
      setLoading(false);
    }
  };

  // Skeleton pendant la détection
  if (state === 'checking') {
    return <div className="h-10 w-52 animate-pulse rounded-lg bg-gray-800" />;
  }

  // Navigateur incompatible (ou Safari hors écran d'accueil)
  if (state === 'unsupported') {
    return (
      <p className="text-xs text-gray-500">
        Notifications non supportées sur ce navigateur.
        {' '}Sur Safari iOS : ajoutez l'app à l'écran d'accueil.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={state === 'subscribed' ? handleUnsubscribe : handleSubscribe}
        disabled={loading || state === 'denied'}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
          disabled:opacity-50 disabled:cursor-not-allowed ${
          state === 'subscribed'
            ? 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
        }`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : state === 'subscribed' ? (
          <BellOff className="w-4 h-4" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {state === 'subscribed'
          ? 'Désactiver les notifications'
          : 'Activer les notifications'}
      </button>

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
