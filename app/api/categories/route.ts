import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { TypeCategorie } from '@prisma/client';

// GET /api/categories
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const categories = await prisma.categorie.findMany({
      where:   { userId: session.user.id },
      orderBy: { ordre: 'asc' },
      include: {
        // Fond de fonctionnement lié (epargne_autre)
        compteFonds: { select: { id: true, nom: true } },
        // Banque liée (epargne_investissement)
        banque: { select: { id: true, nomBanque: true } },
      },
    });

    return NextResponse.json({ categories });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/categories — Créer
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { nom, type, sousType, ordre, compteFondsId, banqueId } = await req.json();

    const cat = await prisma.categorie.create({
      data: {
        userId:       session.user.id,
        nom,
        type:         type as TypeCategorie,
        sousType:     sousType ?? null,
        ordre:        ordre ?? 0,
        compteFondsId: compteFondsId ?? null,
        banqueId:     banqueId ?? null,
      },
    });

    return NextResponse.json({ success: true, categorie: cat }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// PUT /api/categories — Modifier
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { id, nom, type, sousType, ordre, isActive, compteFondsId, banqueId } = await req.json();

    const cat = await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data: {
        ...(nom       !== undefined ? { nom }       : {}),
        ...(type      !== undefined ? { type: type as TypeCategorie } : {}),
        ...(sousType  !== undefined ? { sousType }  : {}),
        ...(ordre     !== undefined ? { ordre }     : {}),
        ...(isActive  !== undefined ? { isActive }  : {}),
        // Liaison fond (null = délier explicitement)
        ...(compteFondsId !== undefined ? { compteFondsId: compteFondsId || null } : {}),
        // Liaison banque (null = délier explicitement)
        ...(banqueId !== undefined ? { banqueId: banqueId || null } : {}),
      },
    });

    return NextResponse.json({ success: true, categorie: cat });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// DELETE /api/categories?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    // Désactiver plutôt que supprimer (préserve l'historique)
    await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data:  { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
