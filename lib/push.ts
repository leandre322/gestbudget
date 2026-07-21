import webpush from 'web-push';
import prisma from '@/lib/prisma';

// VAPID initialisé une seule fois au chargement du module (perf : évite le set à chaque appel)
webpush.setVapidDetails(
  'mailto:contact@lawdigitals.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return;

  // Défauts alignés sur les chemins réels du manifest (fix : icon-192x192.png n'existe pas)
  const fullPayload: PushPayload = {
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    url: '/suivi',
    ...payload,
  };

  const deadSubs: string[] = [];
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(fullPayload),
        {
          TTL: 86400,       // 24h — requis par Safari iOS 16.4+ (aligné sur lib/webpush.ts)
          urgency: 'normal',
        }
      );
    } catch (e: any) {
      if (e.statusCode === 410 || e.statusCode === 404) deadSubs.push(sub.id);
    }
  }));
  if (deadSubs.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: deadSubs } } });
  }
}