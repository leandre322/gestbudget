import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BudgetPutSchema, BudgetPostSchema } from '@/lib/validators';

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) { result[key] = serializeBigInt(obj[key]); }
    return result;
  }
  return obj;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? '');
    const mois  = parseInt(searchParams.get('mois')  ?? '');

    if (!annee || !mois || mois < 1 || mois > 12)
      return NextResponse.json({ error: 'Parametres invalides' }, { status: 400 });

    let anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });
    if (!anneeRec) {
      anneeRec = await prisma.annee.create({
        data: { userId: session.user.id, annee },
      });
    }

    const budget = await prisma.budgetMensuel.findMany({
      where:   { userId: session.user.id, anneeId: anneeRec.id, mois },
      include: { categorie: true },
      orderBy: { categorie: { ordre: 'asc' } },
    });

    const categories = await prisma.categorie.findMany({
      where:   { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json(serializeBigInt({ anneeId: anneeRec.id, anneeData: anneeRec, budget, categories }));
  } catch (error: any) {
    console.error('GET /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const csrfErr = csrfCheck(req); if (csrfErr) return csrfErr;
    const rawPut = await req.json();
    const { data: putData, error: zodPutErr } = validateBody(BudgetPutSchema, rawPut);
    if (zodPutErr) return zodPutErr;
    const { anneeId, mois, lignes } = putData!;

    const upserts = Object.entries(
      lignes as Record<string, { anticipe: string; reel: string }>
    ).map(([categorieId, vals]) => ({
      userId: session.user.id, anneeId, categorieId, mois,
      montantAnticipe: BigInt(parseInt(vals.anticipe) || 0),
      montantReel:     BigInt(parseInt(vals.reel)     || 0),
    }));

    for (const data of upserts) {
      await prisma.budgetMensuel.upsert({
        where: { userId_anneeId_categorieId_mois: { userId: data.userId, anneeId: data.anneeId, categorieId: data.categorieId, mois: data.mois } },
        update: { montantAnticipe: data.montantAnticipe, montantReel: data.montantReel },
        create: data,
      });
    }

    await logAudit({ userId: session.user.id, action: 'update', entityType: 'budget', details: { mois, anneeId }, req });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PUT /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const csrfErrPost = csrfCheck(req); if (csrfErrPost) return csrfErrPost;
    const rawPost = await req.json();
    const { data: postData, error: zodPostErr } = validateBody(BudgetPostSchema, rawPost);
    if (zodPostErr) return zodPostErr;
    const { anneeId, categorieId, mois, montantAnticipe, montantReel, notes } = postData!;

    const ligne = await prisma.budgetMensuel.upsert({
      where: { userId_anneeId_categorieId_mois: { userId: session.user.id, anneeId, categorieId, mois } },
      update:  { montantAnticipe: BigInt(montantAnticipe ?? 0), montantReel: BigInt(montantReel ?? 0), notes },
      create:  { userId: session.user.id, anneeId, categorieId, mois, montantAnticipe: BigInt(montantAnticipe ?? 0), montantReel: BigInt(montantReel ?? 0), notes },
    });

    await logAudit({ userId: session.user.id, action: 'update', entityType: 'budget', entityId: ligne.id, details: { mois, anneeId }, req });
    return NextResponse.json(serializeBigInt({ success: true, id: ligne.id }));
  } catch (error: any) {
    console.error('POST /api/budget:', error?.message ?? error);
    return NextResponse.json({ error: error?.message ?? 'Erreur interne' }, { status: 500 });
  }
}