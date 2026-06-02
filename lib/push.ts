import webpush from 'web-push';
import prisma from '@/lib/prisma';

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
  const deadSubs: string[] = [];

  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (e: any) {
      if (e.statusCode === 410 || e.statusCode === 404) deadSubs.push(sub.id);
    }
  }));

  if (deadSubs.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: deadSubs } } });
  }
}