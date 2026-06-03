import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { csrfCheck } from '@/lib/api-helpers';

export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req); if (csrfErr) return csrfErr;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { endpoint, keys } = await req.json();
    if (!endpoint || !keys?.p256dh || !keys?.auth)
      return NextResponse.json({ error: 'Subscription invalide' }, { status: 400 });

    await prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId: session.user.id, endpoint } },
      update: { p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: session.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });

    await logAudit({ userId: session.user.id, action: 'push_subscribe', entityType: 'push', req });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { endpoint } = await req.json();
    await prisma.pushSubscription.deleteMany({
      where: { userId: session.user.id, endpoint },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}