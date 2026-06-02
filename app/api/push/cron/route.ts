import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
    }

    const subs = await prisma.pushSubscription.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });

    const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

    await Promise.allSettled(subs.map(s =>
      sendPushToUser(s.userId, {
        title: 'Rappel mensuel GestBudget',
        body: 'Pensez a saisir votre suivi de ' + mois,
        icon: '/icons/icon-192.png',
        url: '/suivi',
        tag: 'rappel-mensuel',
      })
    ));

    return NextResponse.json({ success: true, notified: subs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}