import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { validateBody, csrfCheck } from '@/lib/api-helpers';
import { PushSendSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const raw = await req.json();
    const { data, error } = validateBody(PushSendSchema, raw);
    if (error) return error;

    await sendPushToUser(session.user.id, {
      title: data.title,
      body:  data.body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      url:   data.url ?? '/dashboard',
      tag:   data.tag ?? 'gestbudget',
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}