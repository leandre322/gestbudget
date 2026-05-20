import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { initUserData } from '@/lib/init';
import { envoyerEmailBienvenue } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email, password, nom } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email et mot de passe requis' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Mot de passe trop court (8 caractères minimum)' },
        { status: 400 }
      );
    }

    // Vérifier si email déjà utilisé
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Cet email est déjà utilisé' },
        { status: 409 }
      );
    }

    // Hasher le mot de passe
    const hash = await bcrypt.hash(password, 12);

    // Créer l'utilisateur
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), password: hash, nom },
    });

    // Initialiser catégories, comptes et paramètres
    await initUserData(user.id);

    // Email de bienvenue (non bloquant)
    try {
      await envoyerEmailBienvenue(user.email, nom);
    } catch (emailError) {
      console.warn('Email bienvenue non envoyé :', emailError);
    }

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 }
    );

  } catch (error: any) {
    // Log détaillé dans le terminal
    console.error('❌ Erreur register:', error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? 'Erreur interne' },
      { status: 500 }
    );
  }
}
