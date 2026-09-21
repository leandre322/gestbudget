import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { csrfCheck } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';

// ─────────────────────────────────────────────────────────────────────────────
// GET    /api/2fa/devices          -- statut 2FA + liste des appareils de confiance
// DELETE /api/2fa/devices?id=xxx   -- révoque un appareil
//
// S26 (lot 4) : le GET renvoie desormais aussi totpActive. Plutot qu'un 6e
// endpoint dedie, cette route etait deja "le statut 2FA lu par l'utilisateur
// courant" en substance -- y ajouter un champ est plus simple que multiplier
// les points d'entree pour la meme information.
//
// tokenHash n'est jamais renvoye : ce n'est pas un secret a proprement parler
// (SHA-256, non reversible), mais l'exposer n'apporte rien au client et
// elargit sans raison la surface de ce qui sort de l'API.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const [user, appareils] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: session.user.id },
        select: { totpActive: true },
      }),
      prisma.trustedDevice.findMany({
        where:   { userId: session.user.id },
        select:  { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        orderBy: { lastUsedAt: 'desc' },
      }),
    ]);

    return NextResponse.json({ totpActive: user?.totpActive ?? false, appareils });
  } catch (e: any) {
    console.error('GET /api/2fa/devices:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id)
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const appareil = await prisma.trustedDevice.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!appareil)
      return NextResponse.json({ error: 'Appareil introuvable' }, { status: 404 });

    await prisma.trustedDevice.delete({ where: { id } });

    await logAudit({
      userId:     session.user.id,
      action:     'delete',
      entityType: 'trusted_device',
      entityId:   id,
      entityNom:  appareil.label ?? undefined,
      req,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('DELETE /api/2fa/devices:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
