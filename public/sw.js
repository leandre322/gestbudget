// GestBudget — Service Worker PWA
// Stratégie : Cache-first pour les assets statiques,
//             Network-first pour les API, offline fallback pour les pages

const CACHE_NAME    = 'gestbudget-v1';
const OFFLINE_URL   = '/offline';

// Assets à précacher au install
const PRECACHE_URLS = [
  '/',
  '/dashboard',
  '/suivi',
  '/budget',
  '/ajout-retrait-fonds',
  '/parametres',
  '/offline',
];

// ── Install : précacher les pages principales ─────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // Certaines pages peuvent ne pas exister encore — ignorer
      })
    ).then(() => self.skipWaiting())
  );
});

// ── Activate : supprimer les anciens caches ───────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie intelligente par type de ressource ─────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET et les extensions Chrome
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1. API → Network-first (les données doivent être fraîches)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 2. Assets statiques (_next/static) → Cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. Pages HTML → Network-first avec fallback offline
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOffline(request));
    return;
  }

  // 4. Images, polices → Cache-first
  event.respondWith(cacheFirst(request));
});

// ── Stratégies ───────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Mettre en cache les réponses API réussies (pour offline)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response(
      JSON.stringify({ error: 'Hors ligne — données non disponibles' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirstWithOffline(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback offline
    const offlinePage = await caches.match(OFFLINE_URL);
    return offlinePage ?? new Response(
      '<h1>GestBudget</h1><p>Vous êtes hors ligne. Reconnectez-vous pour accéder à votre budget.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// ── Background sync — Tentative de resynchronisation ────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-budget') {
    event.waitUntil(syncBudget());
  }
});

async function syncBudget() {
  // Placeholder pour la synchronisation offline future
  console.log('[SW] Background sync triggered');
}

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'GestBudget', {
      body:    data.body ?? '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-72.png',
      tag:     data.tag ?? 'gestbudget',
      data:    data.url ? { url: data.url } : undefined,
      actions: data.url ? [{ action: 'open', title: 'Ouvrir' }] : [],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
