import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';
import { genererSecret, chiffrerSecret, genererQrCode } from '@/lib/totp';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/2fa/enroll
//
// Premiere etape de l'activation du 2FA (S26). Genere un secret, le chiffre,
// le stocke SANS activer totpActive : si l'utilisateur abandonne avant
// /api/2fa/activate, rien n'est reellement protege par un secret jamais
// confirme scanne. Chaque appel remplace un enrolement en cours non confirme
// -- permet de reessayer en cas de mauvais scan.
//
// Mot de passe exige : sans ca, une session volee (cookie derobe, XSS)
// pourrait preparer un secret que l'attaquant est seul a connaitre, pret a
// etre active des que l'attaquant aura aussi le code -- fermer ce chemin des
// l'entree, avant meme que le secret n'existe.
// ─────────────────────────────────────────────────────────────────────────────

const EnrollSchema = z.object({
  password: z.string().min(1),
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

    const parsed = validateBody(EnrollSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { password } = parsed.data;

    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { id: true, email: true, password: true, totpActive: true },
    });
    if (!user)
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });

    if (user.totpActive) {
      return NextResponse.json(
        { error: '2FA déjà actif. Désactivez-le avant de le reconfigurer.' },
        { status: 409 },
      );
    }

    const motDePasseValide = await bcrypt.compare(password, user.password);
    if (!motDePasseValide)
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });

    const secret        = genererSecret();
    const secretChiffre  = chiffrerSecret(secret);
    const qrCode         = await genererQrCode(user.email, secret);

    await prisma.user.update({
      where: { id: user.id },
      data:  { totpSecret: secretChiffre },
    });

    await logAudit({
      userId:     user.id,
      action:     'create',
      entityType: '2fa_enrollment',
      req,
    });

    // `secret` en clair : necessaire pour la saisie manuelle si le QR ne peut
    // pas etre scanne. Meme information que celle deja encodee dans le QR --
    // aucune exposition supplementaire.
    return NextResponse.json({ success: true, qrCode, secret });
  } catch (e: any) {
    console.error('POST /api/2fa/enroll:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
