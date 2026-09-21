import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';
import { genererJetonAppareil, dateExpirationAppareil, JOURS_APPAREIL_CONFIANCE } from '@/lib/totp';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/2fa/trust-device
//
// Pose le cookie d'appareil de confiance. authorize() (lib/auth.ts) ne peut
// PAS ecrire de cookie -- c'est pour ca que cette etape existe a part, appelee
// par le client juste apres un signIn() reussi si la case "se souvenir" est
// cochee.
//
// Mot de passe redemande ici (le client le renvoie automatiquement depuis le
// formulaire, sans reinvite visible pour l'utilisateur) : sans cette preuve,
// une session volee (cookie derobe) pourrait s'auto-declarer "appareil de
// confiance" et contourner le 2FA pour les 30 prochains jours -- exactement
// le trou que ce controle ferme.
// ─────────────────────────────────────────────────────────────────────────────

const TrustDeviceSchema = z.object({
  password: z.string().min(1),
  label:    z.string().max(100).optional(),
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

    const parsed = validateBody(TrustDeviceSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { password, label } = parsed.data;

    const user = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { id: true, password: true, totpActive: true },
    });
    if (!user)
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });

    if (!user.totpActive)
      return NextResponse.json({ error: '2FA non actif' }, { status: 400 });

    const motDePasseValide = await bcrypt.compare(password, user.password);
    if (!motDePasseValide)
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });

    const { jetonClair, jetonHash } = genererJetonAppareil();
    const expiresAt = dateExpirationAppareil();

    const appareil = await prisma.trustedDevice.create({
      data: {
        userId:    user.id,
        tokenHash: jetonHash,
        label:     label?.trim() || null,
        expiresAt,
      },
    });

    await logAudit({
      userId:     user.id,
      action:     'create',
      entityType: 'trusted_device',
      entityId:   appareil.id,
      req,
    });

    const res = NextResponse.json({ success: true });
    res.cookies.set('gb_trusted_device', jetonClair, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   JOURS_APPAREIL_CONFIANCE * 24 * 60 * 60,
    });
    return res;
  } catch (e: any) {
    console.error('POST /api/2fa/trust-device:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
