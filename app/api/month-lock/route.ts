import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateUnlockToken, isMonthPast } from '@/lib/month-lock';

// POST /api/month-lock
// Body: { mois: number, annee: number }
// Retourne un token signé HMAC valable 60 minutes
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { mois, annee } = await req.json();

    if (!mois || !annee)
      return NextResponse.json({ error: 'mois et annee obligatoires' }, { status: 400 });

    // Le mois courant n'a pas besoin de token — renvoyer un token vide
    if (!isMonthPast(Number(mois), Number(annee))) {
      return NextResponse.json({ token: null, currentMonth: true });
    }

    const token = generateUnlockToken(session.user.id, Number(mois), Number(annee));

    return NextResponse.json({
      token,
      mois:       Number(mois),
      annee:      Number(annee),
      expiresIn:  3600, // 60 minutes
    });
  } catch (e: any) {
    console.error('POST /api/month-lock:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
