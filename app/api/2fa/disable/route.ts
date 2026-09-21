import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';
import { verifierCode, dechiffrerSecret, verifierCodeSecours } from '@/lib/totp';
import { verifierEtIncrementerLimite, reinitialiserLimite } from '@/lib/rate-limit';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/2fa/disable
//
// Exige le mot de passe ET un code valide (TOTP ou de secours) -- retirer une
// protection ne doit jamais coûter moins cher que l'avoir posée.
//
// Partage le MEME compteur de limite que la verification a la connexion
// (totp:<userId>, voir lib/auth.ts) : deux points d'entree distincts pour
// prouver le meme facteur ne doivent pas doubler le budget de tentatives
// disponible a un attaquant.
//
// Nettoie tout ce qui n'a plus de sens une fois le 2FA coupe : le secret, les
// codes de secours (perimes si reactive plus tard), et les appareils de
// confiance (qui n'etaient "de confiance" que par rapport au 2FA desormais
// absent).
// ─────────────────────────────────────────────────────────────────────────────

const DisableSchema = z.object({
  password: z.string().min(1),
  code:     z.string().min(6).max(9),
});

export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(DisableSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { password, code } = parsed.data;

    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { id: true, password: true, totpActive: true, totpSecret: true },
    });
    if (!user)
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });

    if (!user.totpActive)
      return NextResponse.json({ error: '2FA déjà désactivé' }, { status: 409 });

    const motDePasseValide = await bcrypt.compare(password, user.password);
    if (!motDePasseValide)
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });

    const limite = await verifierEtIncrementerLimite(prisma, `totp:${user.id}`, 5, 5 * 60);
    if (!limite.autorise)
      return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 });

    let codeValide = false;
    const codeNettoye = code.trim();

    if (/^\d{6}$/.test(codeNettoye) && user.totpSecret) {
      const secretClair = dechiffrerSecret(user.totpSecret);
      codeValide = verifierCode(secretClair, codeNettoye);
    } else {
      const codesSecours = await prisma.backupCode.findMany({
        where: { userId: user.id, usedAt: null },
      });
      for (const bc of codesSecours) {
        if (await verifierCodeSecours(codeNettoye, bc.codeHash)) {
          codeValide = true;
          break; // pas besoin de marquer usedAt : le 2FA est sur le point d'etre coupe
        }
      }
    }

    if (!codeValide)
      return NextResponse.json({ error: 'Code invalide' }, { status: 401 });

    await reinitialiserLimite(prisma, `totp:${user.id}`);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data:  { totpActive: false, totpSecret: null, totpActivatedAt: null },
      });
      await tx.backupCode.deleteMany({ where: { userId: user.id } });
      await tx.trustedDevice.deleteMany({ where: { userId: user.id } });
    });

    await logAudit({
      userId:     user.id,
      action:     'update',
      entityType: '2fa',
      details:    { action: 'disabled' },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('POST /api/2fa/disable:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
