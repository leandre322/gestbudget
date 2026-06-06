import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * POST /api/push/subscribe
 * Enregistre un abonnement push pour l'utilisateur courant.
 * Body (objet PushSubscription sérialisé) :
 *   { endpoint: string, keys: { p256dh: string, auth: string } }
 *
 * Schéma Prisma : @@unique([userId, endpoint])
 * → clé Prisma : userId_endpoint (composite)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  try {
    const body = await req.json();
    const { endpoint, keys } = body ?? {};
    const { p256dh, auth } = keys ?? {};

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: 'Subscription invalide — endpoint, p256dh et auth requis' },
        { status: 400 }
      );
    }

    // FIX : @@unique([userId, endpoint]) → where avec clé composite userId_endpoint
    // Pas @unique sur endpoint seul → `where: { endpoint }` lèverait une erreur Prisma
    await prisma.pushSubscription.upsert({
      where:  { userId_endpoint: { userId: session.user.id, endpoint } },
      update: { p256dh, auth },
      create: { endpoint, p256dh, auth, userId: session.user.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/subscribe] POST:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * DELETE /api/push/subscribe
 * Supprime l'abonnement push de l'utilisateur courant.
 * Body : { endpoint: string }
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  try {
    const { endpoint } = (await req.json()) ?? {};
    if (!endpoint)
      return NextResponse.json({ error: 'Endpoint manquant' }, { status: 400 });

    // deleteMany : pas de contrainte unique requise, filtre par userId + endpoint
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: session.user.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/subscribe] DELETE:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
