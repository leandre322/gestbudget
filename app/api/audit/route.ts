import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// POST /api/audit — Enregistrer une action sensible
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { action, entityType, entityId, entityNom, details } = await req.json();
    if (!action) return NextResponse.json({ error: 'action manquante' }, { status: 400 });
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null;
    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, entity_nom, details, ip_address)
      VALUES (${session.user.id}, ${action}, ${entityType ?? null}, ${entityId ?? null},
              ${entityNom ?? null}, ${details ? JSON.stringify(details) : null}::jsonb, ${ip})
    `;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('POST /api/audit:', e?.message);
    return NextResponse.json({ success: false, error: e?.message });
  }
}

// GET /api/audit?limit=50&offset=0
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(100, parseInt(searchParams.get('limit')  ?? '50'));
    const offset = parseInt(searchParams.get('offset') ?? '0');
    const logs = await prisma.$queryRaw<any[]>`
      SELECT id, action, entity_type, entity_nom, details, created_at
      FROM audit_logs WHERE user_id = ${session.user.id}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    const countArr = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS total FROM audit_logs WHERE user_id = ${session.user.id}
    `;
    return NextResponse.json({ logs, total: countArr[0]?.total ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
