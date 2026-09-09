/**
 * worker/index.js — LAW-GestBudget Service Worker
 *
 * Ce fichier est injecte dans le SW genere par next-pwa (customWorkerDir: "worker").
 * Il coexiste avec les handlers de cache de next-pwa.
 *
 * Handlers : push, notificationclick
 *
 * ───────────────────────────────────────────────────────────────────────────
 * S23 / P130 — LE GARDIEN DE SESSION EST RETIRE.
 *
 * Les handlers `message` (reception ACTIVITY) et `fetch` (401 sur /api/ si
 * inactivite) ont ete supprimes. Ils etaient la cause des deconnexions
 * intempestives, par le mecanisme suivant :
 *
 *   1. Un service worker est UNIQUE pour toute l origine. `lastActivityTs`
 *      etait une variable globale unique, ecrasee par le dernier message
 *      recu, quel que soit le contexte emetteur (onglet, PWA installee).
 *
 *   2. Le thread principal n emettait ACTIVITY qu une fois par minute
 *      (SW_NOTIFY_MS), et abandonnait l envoi EN SILENCE si
 *      navigator.serviceWorker.controller valait null — cas systematique
 *      dans un contexte charge avant l activation du SW courant, donc apres
 *      chaque deploiement (skipWaiting: true).
 *
 *   3. Le worker conservait alors un `lastActivityTs` perime. A 30 minutes,
 *      il diffusait SESSION_EXPIRED sur BroadcastChannel ET refusait la salve
 *      d appels en cours par un 401 fabrique — pendant l usage actif.
 *
 * Ce gardien dupliquait un controle deja assure par le thread principal
 * (polling 15 s + Page Visibility), avec un etat plus fragile et une portee
 * plus large. Il n apportait aucune securite : le serveur maintient la
 * session 24 h et un cookie vole ignore integralement ce mecanisme. C etait
 * de l ergonomie appliquee avec un outil de securite, au prix d une panne
 * de disponibilite.
 *
 * Le controle d inactivite reste entierement dans lib/inactivity.tsx.
 * ───────────────────────────────────────────────────────────────────────────
 */

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