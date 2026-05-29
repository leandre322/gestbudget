import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { TypeCategorie } from '@prisma/client';

// GET /api/categories
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifiÃ©' }, { status: 401 });

    // Essayer avec la relation banque (nÃ©cessite la colonne banque_id en DB)
    // Fallback sans la relation si la colonne n'existe pas encore
    let categories: any[];
    try {
      categories = await prisma.categorie.findMany({
        where:   { userId: session.user.id },
        orderBy: { ordre: 'asc' },
        include: {
          compteFonds: { select: { id: true, nom: true } },
          banque:      { select: { id: true, nomBanque: true } },
        },
      });
    } catch (includeErr: any) {
      // Fallback : colonne banque_id probablement absente en DB
      console.warn('GET /api/categories: banque relation failed, falling back:', includeErr?.message?.substring(0, 100));
      categories = await prisma.categorie.findMany({
        where:   { userId: session.user.id },
        orderBy: { ordre: 'asc' },
        include: {
          compteFonds: { select: { id: true, nom: true } },
        },
      });
      // Ajouter banqueId: null sur chaque catÃ©gorie pour Ã©viter les erreurs cÃ´tÃ© client
      categories = categories.map((c: any) => ({ ...c, banqueId: null, banque: null }));
    }

    return NextResponse.json({ categories });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/categories â€” CrÃ©er
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifiÃ©' }, { status: 401 });

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

// PUT /api/categories â€” Modifier
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifiÃ©' }, { status: 401 });

    const { id, nom, type, sousType, ordre, isActive, compteFondsId, banqueId } = await req.json();

    const cat = await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data: {
        ...(nom       !== undefined ? { nom }       : {}),
        ...(type      !== undefined ? { type: type as TypeCategorie } : {}),
        ...(sousType  !== undefined ? { sousType }  : {}),
        ...(ordre     !== undefined ? { ordre }     : {}),
        ...(isActive  !== undefined ? { isActive }  : {}),
        // Liaison fond (null = dÃ©lier explicitement)
        ...(compteFondsId !== undefined ? { compteFondsId: compteFondsId || null } : {}),
        // Liaison banque (null = dÃ©lier explicitement)
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
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifiÃ©' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    // DÃ©sactiver plutÃ´t que supprimer (prÃ©serve l'historique)
    await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data:  { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

