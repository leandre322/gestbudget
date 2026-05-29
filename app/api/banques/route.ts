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

// GET /api/banques
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const banques = await prisma.banque.findMany({
      where:   { userId: session.user.id },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json(serial({ banques }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/banques — Créer une banque
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { nomBanque, typeCompte, soldeInitial, ordre } = await req.json();

    const banque = await prisma.banque.create({
      data: {
        userId:    session.user.id,
        nomBanque: nomBanque ?? 'Nouvelle banque',
        typeCompte: typeCompte ?? null,
        solde:     BigInt(soldeInitial ?? 0),
        ordre:     ordre ?? 0,
      },
    });

    return NextResponse.json(serial({ success: true, banque }), { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// PUT /api/banques?id=xxx — Modifier une banque
// Body options :
//   { nomBanque: string }                          → renommer
//   { action: 'set',       montant: number }       → fixer le solde
//   { action: 'increment', montant: number }       → solde += montant
//   { action: 'decrement', montant: number }       → solde -= montant (plancher 0)
//   { solde: number }                              → fixer le solde (alias de set)
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const body = await req.json();
    const { action, montant, nomBanque, solde: soldeDirect } = body;

    // Vérifier propriété
    const existing = await prisma.banque.findFirst({
      where:  { id, userId: session.user.id },
      select: { solde: true },
    });
    if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

    const updateData: any = { updatedAt: new Date() };

    if (nomBanque !== undefined) {
      updateData.nomBanque = nomBanque;
    }

    if (action === 'set' || soldeDirect !== undefined) {
      const val = action === 'set' ? montant : soldeDirect;
      updateData.solde = BigInt(Math.round(Number(val ?? 0)));
    } else if (action === 'increment') {
      const current = BigInt(Number(existing.solde ?? 0));
      const inc     = BigInt(Math.round(Number(montant ?? 0)));
      updateData.solde = current + inc;
    } else if (action === 'decrement') {
      const current = BigInt(Number(existing.solde ?? 0));
      const dec     = BigInt(Math.round(Number(montant ?? 0)));
      const next    = current - dec;
      updateData.solde = next < BigInt(0) ? BigInt(0) : next;
    }

    const banque = await prisma.banque.update({
      where: { id },
      data:  updateData,
    });

    return NextResponse.json(serial({ success: true, banque }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// DELETE /api/banques?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.banque.delete({ where: { id, userId: session.user.id } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
