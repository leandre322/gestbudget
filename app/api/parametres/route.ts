import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const [params, categories] = await Promise.all([
      prisma.parametres.findUnique({ where: { userId: session.user.id } }),
      prisma.categorie.findMany({
        where:  { userId: session.user.id, isActive: true },
        select: { id: true, type: true, tauxReference: true, montantReference: true },
      }),
    ]);

    return NextResponse.json({
      devise:                 params?.devise          ?? 'FCFA',
      themeCouleur:           params?.themeCouleur    ?? 'blue',
      anneeCourante:          params?.anneeCourante   ?? new Date().getFullYear(),
      moisCourant:            params?.moisCourant     ?? new Date().getMonth() + 1,
      revenuMensuelReference: n(params?.revenuMensuelReference ?? 0),
      categories: categories.map(c => ({
        id:               c.id,
        type:             c.type,
        tauxReference:    c.tauxReference    ?? 0,
        montantReference: n(c.montantReference),
      })),
    });
  } catch (e: any) {
    console.error('GET /api/parametres:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { revenuMensuelReference, tauxReference } = await req.json();

    await prisma.parametres.upsert({
      where:  { userId: session.user.id },
      create: { userId: session.user.id, revenuMensuelReference: BigInt(revenuMensuelReference ?? 0) },
      update: { revenuMensuelReference: BigInt(revenuMensuelReference ?? 0), updatedAt: new Date() },
    });

    if (tauxReference) {
      for (const [type, taux] of Object.entries(tauxReference)) {
        const montant = (revenuMensuelReference ?? 0) > 0
          ? Math.round(((taux as number) / 100) * (revenuMensuelReference ?? 0))
          : 0;
        await prisma.categorie.updateMany({
          where: { userId: session.user.id, type },
          data:  { tauxReference: taux as number, montantReference: BigInt(montant) },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('PUT /api/parametres:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}