import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { initUserData } from '@/lib/init';
import { envoyerEmailBienvenue } from '@/lib/email';
import { validateBody, csrfCheck } from '@/lib/api-helpers';
import { RegisterSchema } from '@/lib/validators';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const raw = await req.json();
    const { data, error } = validateBody(RegisterSchema, raw);
    if (error) return error;
    const { email, password, nom } = data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'Cet email est deja utilise' }, { status: 409 });

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hash, nom },
    });

    await initUserData(user.id);

    try { await envoyerEmailBienvenue(user.email, nom); } catch {}

    await logAudit({
      userId: user.id, action: 'register',
      entityType: 'user', entityId: user.id,
      details: { email: user.email },
      req,
    });

    return NextResponse.json({ success: true, userId: user.id }, { status: 201 });
  } catch (e: any) {
    console.error('register:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}