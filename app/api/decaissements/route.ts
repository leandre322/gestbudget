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

// GET /api/decaissements?annee=2026
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? String(new Date().getFullYear()));

    const comptes = await prisma.compteFonds.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });

    const decaissements = await prisma.decaissement.findMany({
      where: anneeRec
        ? { userId: session.user.id, anneeId: anneeRec.id }
        : { userId: session.user.id },
      include: { repartitions: { include: { compte: true } } },
      orderBy: { dateOperation: 'desc' },
    });

    return NextResponse.json(serial({
      comptes,
      decaissements,
      anneeId: anneeRec?.id ?? null,
    }));
  } catch (e: any) {
    console.error('GET /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// POST /api/decaissements — Créer
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const {
      anneeId, description, dateOperation,
      montantTotal, repartitions, notes,
      typeMouvement,
    } = await req.json();

    if (!description || !dateOperation || !montantTotal) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 });
    }

    const dec = await prisma.decaissement.create({
      data: {
        userId:        session.user.id,
        anneeId:       anneeId ?? null,
        description,
        dateOperation: new Date(dateOperation),
        montantTotal:  BigInt(montantTotal),
        notes:         notes ?? null,
        typeMouvement: typeMouvement ?? 'retrait',
      },
    });

    if (repartitions && Object.keys(repartitions).length > 0) {
      const reps = Object.entries(repartitions as Record<string, string>)
        .filter(([_, v]) => parseInt(v) > 0)
        .map(([compteId, montant]) => ({
          decaissementId: dec.id,
          compteId,
          montant: BigInt(parseInt(montant)),
        }));
      if (reps.length > 0) {
        await prisma.decaissementCompte.createMany({ data: reps });
      }
    }

    return NextResponse.json(serial({ success: true, id: dec.id }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/decaissements:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// DELETE /api/decaissements?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.decaissement.delete({
      where: { id, userId: session.user.id },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}