import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { TypeCategorie } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const categories = await prisma.categorie.findMany({
      where:   { userId: session.user.id },
      orderBy: { ordre: 'asc' },
      include: { compteFonds: { select: { id: true, nom: true } } },
    });

    // serial() gere les BigInt (montantReference)
    // enveloppeActive est un Boolean — passe dans serial() sans transformation
    return NextResponse.json(serial({ categories }));
  } catch (e: any) {
    console.error('GET /api/categories:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/categories
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const {
      nom,
      type,
      sousType,
      ordre,
      compteFondsId,
      banqueId,
      enveloppeActive,  // D2 — enveloppes budgetaires
    } = await req.json();

    const cat = await prisma.categorie.create({
      data: {
        userId:          session.user.id,
        nom,
        type:            type as TypeCategorie,
        sousType:        sousType ?? null,
        ordre:           ordre ?? 0,
        compteFondsId:   compteFondsId ?? null,
        banqueId:        banqueId ?? null,
        enveloppeActive: enveloppeActive ?? false, // D2
      },
    });

    return NextResponse.json({ success: true, categorie: cat }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/categories:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/categories
// ─────────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const {
      id,
      nom,
      type,
      sousType,
      ordre,
      isActive,
      compteFondsId,
      banqueId,
      enveloppeActive,  // D2 — enveloppes budgetaires
      montantReference, // D2 — budget enveloppe (peut aussi etre mis a jour ici)
    } = await req.json();

    const cat = await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data: {
        ...(nom              !== undefined ? { nom }                                 : {}),
        ...(type             !== undefined ? { type: type as TypeCategorie }         : {}),
        ...(sousType         !== undefined ? { sousType }                            : {}),
        ...(ordre            !== undefined ? { ordre }                               : {}),
        ...(isActive         !== undefined ? { isActive }                            : {}),
        ...(compteFondsId    !== undefined ? { compteFondsId: compteFondsId || null }: {}),
        ...(banqueId         !== undefined ? { banqueId: banqueId || null }          : {}),
        ...(enveloppeActive  !== undefined ? { enveloppeActive }                     : {}), // D2
        ...(montantReference !== undefined ? { montantReference: BigInt(montantReference) } : {}), // D2
      },
    });

    return NextResponse.json({ success: true, categorie: cat });
  } catch (e: any) {
    console.error('PUT /api/categories:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/categories?id=xxx  (desactivation soft)
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    await prisma.categorie.update({
      where: { id, userId: session.user.id },
      data:  { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/categories:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
