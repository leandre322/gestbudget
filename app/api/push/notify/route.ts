import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendPushToUser } from '@/lib/webpush';
import { z } from 'zod';

const NotifySchema = z.object({
  title: z.string().min(1).max(100),
  body:  z.string().min(1).max(200),
  url:   z.string().optional().default('/suivi'),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ message: 'JSON invalide' }, { status: 400 });
  }

  const parsed = NotifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: 'Donnees invalides' }, { status: 422 });
  }

  await sendPushToUser(
    session.user.id,
    parsed.data.title,
    parsed.data.body,
    parsed.data.url,
  );

  return NextResponse.json({ ok: true });
}
