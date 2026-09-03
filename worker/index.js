/**
 * worker/index.js — LAW-GestBudget Service Worker
 *
 * Ce fichier est injecte dans le SW genere par next-pwa (customWorkerDir: "worker").
 * Il coexiste avec les handlers de cache de next-pwa.
 *
 * Handlers existants : push, notificationclick
 * Nouveaux (P4)      : message (reception activite), fetch (gardien de session)
 */

// ─── P4 — Etat session ───────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // Doit correspondre a lib/inactivity.tsx

// null = SW vient de demarrer, pas encore recu de message du thread principal.
// Dans ce cas, le fetch interceptor ne bloque pas (evite les faux positifs au
// demarrage ou apres un redemarrage du SW).
let lastActivityTs = null;

// Routes publiques exclues du gardien de session
const PUBLIC_API_ROUTES = [
  '/api/auth',
  '/api/register',
  '/api/push/subscribe', // FIX : abonnement push ne doit jamais etre bloque par le gardien
  '/api/push/test',      // FIX : test push ne doit jamais etre bloque par le gardien
];

// ─── P4 — Reception des mises a jour d'activite du thread principal ───────────
//
// InactivityGuard envoie { type: 'ACTIVITY', ts: Date.now() } via
// navigator.serviceWorker.controller.postMessage() a chaque resetTimer,
// une fois par minute maximum (debounce dans inactivity.tsx).

self.addEventListener('message', function (event) {
  if (event.data?.type === 'ACTIVITY') {
    lastActivityTs = event.data.ts ?? Date.now();
  }
});

// ─── P4 — Gardien de session sur les appels API ──────────────────────────────
//
// Intercepte les requetes vers /api/ et retourne 401 si la session est expiree.
// Si lastActivityTs est null (SW vient de demarrer), laisse passer la requete.
// Les handlers next-pwa prennent le relai si event.respondWith() n'est pas appele.

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  // 1. Ignorer les assets statiques — laisser next-pwa gerer le cache
  if (!url.pathname.startsWith('/api/')) return;

  // 2. Ignorer les routes publiques
  if (PUBLIC_API_ROUTES.some(function (r) { return url.pathname.startsWith(r); })) return;

  // 3. SW vient de demarrer : pas encore de timestamp du thread principal
  //    -> Ne pas bloquer, le thread principal (P1+P2) gere le timeout
  if (lastActivityTs === null) return;

  // 4. Verifier l'inactivite
  const elapsed = Date.now() - lastActivityTs;

  if (elapsed >= SESSION_TIMEOUT_MS) {
    // Notifier le thread principal via BroadcastChannel
    // (InactivityGuard ecoute ce canal et appelle signOut())
    try {
      var channel = new BroadcastChannel('gb_session');
      channel.postMessage({ type: 'SESSION_EXPIRED' });
      channel.close();
    } catch (_) {
      // BroadcastChannel non disponible : le thread principal gerera via polling
    }

    // Bloquer la requete avec une reponse 401
    event.respondWith(
      new Response(
        JSON.stringify({
          error: 'Session expiree',
          code:  'SESSION_EXPIRED',
        }),
        {
          status:  401,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
  }

  // Session active : ne pas appeler event.respondWith()
  // -> next-pwa gere normalement (reseau + cache selon runtimeCaching)
});

// ─── Push notifications ──────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  if (!event.data) return;

  var payload;
  try {
    payload = event.data.json();
  } catch (_) {
    payload = { title: 'GestBudget', body: event.data.text() };
  }

  var options = {
    body:               payload.body    ?? '',
    icon:               payload.icon    ?? '/icons/icon-192.png',
    badge:              payload.badge   ?? '/icons/icon-72.png',
    tag:                payload.tag     ?? 'gestbudget',
    data:               { url: payload.url ?? '/dashboard' },
    actions:            [{ action: 'open', title: 'Voir' }],
    vibrate:            [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'GestBudget', options)
  );
});

// ─── Notification click ──────────────────────────────────────────────────────

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var url = event.notification.data?.url ?? '/dashboard';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (list) {
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
