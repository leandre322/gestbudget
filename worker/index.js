self.addEventListener('push', function(event) {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'GestBudget', body: event.data.text() }; }

  const options = {
    body:    payload.body    ?? '',
    icon:    payload.icon    ?? '/icons/icon-192.png',
    badge:   payload.badge   ?? '/icons/icon-72.png',
    tag:     payload.tag     ?? 'gestbudget',
    data:    { url: payload.url ?? '/dashboard' },
    actions: [{ action: 'open', title: 'Voir' }],
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title ?? 'GestBudget', options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url ?? '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});