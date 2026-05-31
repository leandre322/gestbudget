import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function serial(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serial);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

// GET /api/correctifs-kpi
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const correctifs = await (prisma as any).correctifKpi.findMany({
      where:   { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(serial({ correctifs }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/correctifs-kpi
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { kpi, montant, motif } = await req.json();

    if (!['revenus','depenses','epargne'].includes(kpi))
      return NextResponse.json({ error: 'KPI invalide' }, { status: 400 });
    if (!motif?.trim())
      return NextResponse.json({ error: 'Motif obligatoire' }, { status: 400 });
    if (montant === 0)
      return NextResponse.json({ error: 'Montant ne peut pas être 0' }, { status: 400 });

    const correctif = await (prisma as any).correctifKpi.create({
      data: {
        userId:  session.user.id,
        kpi,
        montant: BigInt(Math.round(Number(montant))),
        motif:   motif.trim(),
      },
    });
    return NextResponse.json(serial({ success: true, id: correctif.id }), { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// DELETE /api/correctifs-kpi?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const existing = await (prisma as any).correctifKpi.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing)
      return NextResponse.json({ error: 'Correctif introuvable' }, { status: 404 });

    await (prisma as any).correctifKpi.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
