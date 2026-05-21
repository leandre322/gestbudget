import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

// GET /api/banques — Liste des banques configurées
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const banques = await prisma.banque.findMany({
      where: { userId: session.user.id, isActive: true, mois: null },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json({
      banques: banques.map(b => ({
        id:        b.id,
        nomBanque: b.nomBanque,
        solde:     n(b.solde),
        ordre:     b.ordre,
        isActive:  b.isActive,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/banques — Créer une banque
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { nomBanque, soldeInitial } = await req.json();
    if (!nomBanque) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });

    const count = await prisma.banque.count({
      where: { userId: session.user.id, mois: null },
    });

    const banque = await prisma.banque.create({
      data: {
        userId:    session.user.id,
        nomBanque,
        solde:     BigInt(soldeInitial ?? 0),
        ordre:     count,
        mois:      null,
        anneeId:   null,
      },
    });

    return NextResponse.json({ success: true, id: banque.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// PUT /api/banques?id=xxx — Modifier ou incrémenter/décrémenter solde
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const body = await req.json();

    // Vérifier que la banque appartient à l'utilisateur
    const banque = await prisma.banque.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!banque) return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });

    let updateData: any = {};

    if (body.action === 'increment') {
      // Incrémenter le solde
      updateData.solde = banque.solde + BigInt(body.montant ?? 0);
    } else if (body.action === 'decrement') {
      // Décrémenter le solde
      updateData.solde = banque.solde - BigInt(body.montant ?? 0);
    } else if (body.action === 'set') {
      // Remplacer le solde
      updateData.solde = BigInt(body.montant ?? 0);
    } else {
      // Mise à jour du nom
      if (body.nomBanque) updateData.nomBanque = body.nomBanque;
      if (body.solde !== undefined) updateData.solde = BigInt(body.solde);
    }

    const updated = await prisma.banque.update({
      where: { id },
      data:  { ...updateData, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, solde: n(updated.solde) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// DELETE /api/banques?id=xxx — Désactiver une banque
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    await prisma.banque.updateMany({
      where: { id, userId: session.user.id },
      data:  { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}