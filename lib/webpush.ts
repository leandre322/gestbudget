import webpush from 'web-push';
import prisma from '@/lib/prisma'; // import default sans destructuring (règle active)

webpush.setVapidDetails(
  'mailto:admin@gestbudget.app',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export async function sendPushToUser(
  userId: string,
  title:  string,
  body:   string,
  url =   '/suivi',
): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return;

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon:  '/icons/icon-192.png', // FIX : /icon-192.png → /icons/icon-192.png
    badge: '/icons/icon-72.png',  // FIX : aligné avec le fallback de worker/index.js
    // tag non inclus → worker/index.js applique le fallback 'gestbudget'
    // (chaque bilan hebdo remplace le précédent — comportement voulu)
  });

  await Promise.allSettled(
    subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            TTL:     86400,    // 24h — requis par Safari iOS 16.4+
            urgency: 'normal',
          },
        )
        .catch(async (err: any) => {
          // Subscription expirée ou révoquée → nettoyage automatique
          if (err.statusCode === 410 || err.statusCode === 404) {
            await prisma.pushSubscription
              .deleteMany({ where: { endpoint: sub.endpoint } })
              .catch(() => {});
          }
        }),
    ),
  );
}
