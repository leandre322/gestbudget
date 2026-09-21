import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';
import { dechiffrerSecret, verifierCode, genererCodesSecours } from '@/lib/totp';
import { verifierEtIncrementerLimite, reinitialiserLimite } from '@/lib/rate-limit';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/2fa/activate
//
// Deuxieme etape : confirme que le QR de /enroll a bien ete scanne, avant de
// basculer totpActive a true. Les codes de secours ne sont generes qu'ICI, au
// moment ou le 2FA devient reellement actif. Rendus en clair UNE SEULE FOIS
// dans la reponse ; seuls leurs hachages persistent en base.
// ─────────────────────────────────────────────────────────────────────────────

const ActivateSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code à 6 chiffres attendu'),
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

    const parsed = validateBody(ActivateSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { code } = parsed.data;

    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { id: true, totpActive: true, totpSecret: true },
    });
    if (!user)
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });

    if (user.totpActive)
      return NextResponse.json({ error: '2FA déjà actif' }, { status: 409 });

    if (!user.totpSecret)
      return NextResponse.json(
        { error: 'Aucun enrôlement en cours. Lancez /api/2fa/enroll d\u2019abord.' },
        { status: 400 },
      );

    const limite = await verifierEtIncrementerLimite(prisma, `totp-activate:${user.id}`, 5, 5 * 60);
    if (!limite.autorise)
      return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 });

    const secretClair = dechiffrerSecret(user.totpSecret);
    const codeValide   = verifierCode(secretClair, code);

    if (!codeValide)
      return NextResponse.json({ error: 'Code invalide' }, { status: 401 });

    await reinitialiserLimite(prisma, `totp-activate:${user.id}`);

    const { codes, hachages } = await genererCodesSecours();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data:  { totpActive: true, totpActivatedAt: new Date() },
      });
      await tx.backupCode.createMany({
        data: hachages.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });

    await logAudit({
      userId:     user.id,
      action:     'update',
      entityType: '2fa',
      details:    { action: 'enabled' },
      req,
    });

    return NextResponse.json({ success: true, backupCodes: codes });
  } catch (e: any) {
    console.error('POST /api/2fa/activate:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
