import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function serial(v: any): any {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(serial);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, serial(val)]));
  return v;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Non autorise' }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const mois     = parseInt(searchParams.get('mois')  ?? '0', 10);
  const anneeInt = parseInt(searchParams.get('annee') ?? '0', 10);

  if (!mois || !anneeInt) {
    return NextResponse.json({ message: 'Parametres mois/annee requis' }, { status: 400 });
  }

  try {
    // 1. Trouver l'Annee record
    const anneeRecord = await prisma.annee.findFirst({
      where: { userId, annee: anneeInt },
    });

    // 2. Categories avec enveloppe active
    const categories = await prisma.categorie.findMany({
      where:   { userId, enveloppeActive: true, isActive: true },
      orderBy: [{ type: 'asc' }, { ordre: 'asc' }],
    });

    // 3. Depenses du mois pour ces categories
    let budgetMap: Record<string, { montantReel: bigint; montantAnticipe: bigint }> = {};

    if (anneeRecord) {
      const budgets = await prisma.budgetMensuel.findMany({
        where: {
          anneeId:     anneeRecord.id,
          mois,
          categorieId: { in: categories.map(c => c.id) },
        },
        select: { categorieId: true, montantReel: true, montantAnticipe: true },
      });
      budgetMap = Object.fromEntries(
        budgets.map(b => [b.categorieId, {
          montantReel:     b.montantReel,
          montantAnticipe: b.montantAnticipe,
        }]),
      );
    }

    const enveloppes = categories.map(cat => ({
      id:               cat.id,
      nom:              cat.nom,
      type:             cat.type,
      montantReference: cat.montantReference,
      enveloppeActive:  cat.enveloppeActive,
      montantReel:      budgetMap[cat.id]?.montantReel      ?? BigInt(0),
      montantAnticipe:  budgetMap[cat.id]?.montantAnticipe  ?? BigInt(0),
    }));

    return NextResponse.json(serial({ enveloppes }));
  } catch (e: any) {
    console.error('[GET /api/enveloppes]', e);
    return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });
  }
}
