import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password || password.length < 8) {
      return NextResponse.json({ error: 'Donnees invalides' }, { status: 400 });
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Lien invalide ou expire' }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);

    // S26 (B2a + B2b) : un reset de mot de passe doit fermer tous les acces
    // ouverts avant lui, pas seulement changer le mot de passe.
    //   - tokenVersion incremente -> toute session JWT deja emise echoue a
    //     la prochaine verification (voir lib/auth.ts et middleware.ts).
    //   - trustedDevice.deleteMany -> tout appareil marque "de confiance"
    //     repasse par le TOTP a la prochaine connexion.
    // Les trois ecritures sont groupees dans une seule transaction : un
    // echec partiel (mot de passe change mais appareils non revoques, par
    // exemple) serait pire qu'un echec total.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data:  { password: hash, tokenVersion: { increment: 1 } },
      }),
      prisma.trustedDevice.deleteMany({ where: { userId: resetToken.userId } }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data:  { used: true },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erreur reset-password:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}