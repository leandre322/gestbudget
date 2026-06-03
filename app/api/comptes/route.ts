import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';
import { logAudit } from '@/lib/audit';
import { validateBody, csrfCheck } from '@/lib/api-helpers';
import { CompteFondsUpdateSchema } from '@/lib/validators';

function serial(obj: any): any {
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(serial);
  if (obj && typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const comptes = await prisma.compteFonds.findMany({
      where:   { userId: session.user.id },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json(serial({ comptes }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { nom, ordre } = await req.json();
    if (!nom) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });

    const compte = await prisma.compteFonds.create({
      data: { userId: session.user.id, nom, ordre: ordre ?? 0 },
    });

    return NextResponse.json(serial({ success: true, compte }), { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Lire l'id depuis le body OU depuis les query params
    const url = new URL(req.url);
    const idParam = url.searchParams.get('id');

    const body = await req.json();
    const { id: idBody, nom, ordre, isActive, action, montant, seuilAlerte, objectif } = body;
    const id = idParam ?? idBody;

    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    // ── Mode action : increment / decrement / set sur soldeActuel ──────────
    if (action === 'increment' || action === 'decrement' || action === 'set') {
      // Vérifier que le compte appartient à l'utilisateur
      const existing = await prisma.compteFonds.findFirst({
        where: { id, userId: session.user.id },
        select: { soldeActuel: true },
      });
      if (!existing) return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });

      let newSolde: bigint;
      const montantVal  = BigInt(Math.round(Number(montant) || 0));
      const soldeActuel = BigInt(Number(existing.soldeActuel ?? 0));

      if (action === 'set') {
        newSolde = montantVal;
      } else if (action === 'increment') {
        newSolde = soldeActuel + montantVal;
      } else {
        // decrement — ne pas descendre en dessous de 0
        newSolde = soldeActuel - montantVal;
        if (newSolde < BigInt(0)) newSolde = BigInt(0);
      }

      const compte = await prisma.compteFonds.update({
        where: { id },
        data:  { soldeActuel: newSolde, updatedAt: new Date() },
      });

      if (compte.seuilAlerte && compte.seuilAlerte > BigInt(0) && newSolde < compte.seuilAlerte) {
        try {
          await sendPushToUser(session.user.id, {
            title: 'Alerte seuil — ' + compte.nom,
            body: 'Solde ' + Number(newSolde).toLocaleString('fr-FR') + ' FCFA / seuil ' + Number(compte.seuilAlerte).toLocaleString('fr-FR') + ' FCFA',
            icon: '/icons/icon-192.png',
            url: '/dashboard',
            tag: 'seuil-' + id,
          });
        } catch {}
      }
      return NextResponse.json(serial({ success: true, compte }));
    }

    // ── Mode normal : mise à jour nom / ordre / isActive ───────────────────
    const compte = await prisma.compteFonds.update({
      where: { id, userId: session.user.id },
      data:  { nom, ordre, isActive, objectif: objectif !== undefined ? BigInt(Math.max(0, Number(objectif))) : undefined, seuilAlerte: seuilAlerte !== undefined ? BigInt(Math.max(0, Math.round(Number(seuilAlerte)))) : undefined },
    });

    return NextResponse.json(serial({ success: true, compte }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });


    await prisma.compteFonds.update({
      where: { id, userId: session.user.id },
      data:  { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
