import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const annees = await prisma.annee.findMany({
      where:   { userId: session.user.id },
      orderBy: { annee: 'asc' },
      select:  { annee: true },
    });
    return NextResponse.json({ annees: annees.map(a => a.annee) });
  } catch (e: any) {
    console.error('API annees error:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}