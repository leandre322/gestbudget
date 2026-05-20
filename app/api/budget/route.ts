import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// Convertir BigInt en Number pour la sérialisation JSON
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  return obj;
}

// GET /api/budget?annee=2026&mois=5
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? '');
    const mois  = parseInt(searchParams.get('mois')  ?? '');

    if (!annee || !mois || mois < 1 || mois > 12) {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
    }

    // Récupérer ou créer l'année
    let anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });
    if (!anneeRec) {
      anneeRec = await prisma.annee.create({
        data: { userId: session.user.id, annee },
      });
    }

    // Budget du mois avec catégories
    const budget = await prisma.budgetMensuel.findMany({
      where:   { userId: session.user.id, anneeId: anneeRec.id, mois },
      include: { categorie: true },
      orderBy: { categorie: { ordre: 'asc' } },
    });

    // Toutes les catégories actives
    const categories = await prisma.categorie.findMany({
      where:   { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json(serializeBigInt({
      anneeId:   anneeRec.id,
      anneeData: anneeRec,
      budget,
      categories,
    }));

  } catch (error: any) {
    console.error('❌ GET /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// PUT /api/budget — Sauvegarde en masse (auto-save)
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { anneeId, mois, lignes } = await req.json();

    if (!anneeId || !mois || !lignes) {
      return NextResponse.json({ error: 'Données manquantes' }, { status: 400 });
    }

    const upserts = Object.entries(
      lignes as Record<string, { anticipe: string; reel: string }>
    ).map(([categorieId, vals]) => ({
      userId:          session.user.id,
      anneeId,
      categorieId,
      mois,
      montantAnticipe: BigInt(parseInt(vals.anticipe) || 0),
      montantReel:     BigInt(parseInt(vals.reel)     || 0),
    }));

    // Upsert en séquence
    for (const data of upserts) {
      await prisma.budgetMensuel.upsert({
        where: {
          userId_anneeId_categorieId_mois: {
            userId:      data.userId,
            anneeId:     data.anneeId,
            categorieId: data.categorieId,
            mois:        data.mois,
          },
        },
        update:  { montantAnticipe: data.montantAnticipe, montantReel: data.montantReel },
        create:  data,
      });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('❌ PUT /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// POST /api/budget — Upsert ligne unique
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { anneeId, categorieId, mois, montantAnticipe, montantReel, notes } = await req.json();

    const ligne = await prisma.budgetMensuel.upsert({
      where: {
        userId_anneeId_categorieId_mois: {
          userId: session.user.id, anneeId, categorieId, mois,
        },
      },
      update:  {
        montantAnticipe: BigInt(montantAnticipe ?? 0),
        montantReel:     BigInt(montantReel ?? 0),
        notes,
      },
      create:  {
        userId:          session.user.id,
        anneeId,
        categorieId,
        mois,
        montantAnticipe: BigInt(montantAnticipe ?? 0),
        montantReel:     BigInt(montantReel ?? 0),
        notes,
      },
    });

    return NextResponse.json(serializeBigInt({ success: true, id: ligne.id }));

  } catch (error: any) {
    console.error('❌ POST /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
