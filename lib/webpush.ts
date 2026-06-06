import webpush from 'web-push';
import { prisma } from '@/lib/prisma';

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

  const payload = JSON.stringify({ title, body, url, icon: '/icon-192.png' });

  await Promise.allSettled(
    subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        .catch(async (err: any) => {
          // Subscription expirée → nettoyage automatique
          if (err.statusCode === 410 || err.statusCode === 404) {
            await prisma.pushSubscription
              .deleteMany({ where: { endpoint: sub.endpoint } })
              .catch(() => {});
          }
        }),
    ),
  );
}
