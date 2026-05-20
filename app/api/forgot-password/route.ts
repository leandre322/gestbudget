import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { envoyerEmailReset } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Réponse identique que l'email existe ou non (sécurité)
    if (!user) {
      return NextResponse.json({ success: true });
    }

    // Invalider les anciens tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data:  { used: true },
    });

    // Créer un nouveau token (valide 1h)
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        token,
        userId:    user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await envoyerEmailReset(user.email, token, user.nom ?? undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erreur forgot-password:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
