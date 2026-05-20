import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

// GET /api/fonds — Fonds de roulement avec calcul auto + solde manuel
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Comptes de fonds (solde manuel)
    const comptes = await prisma.compteFonds.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    // Catégories de type epargne_autre (pour calcul auto)
    const categories = await prisma.categorie.findMany({
      where: { userId: session.user.id, type: 'epargne_autre', isActive: true },
    });

    // Tous les budgets epargne_autre (calcul auto)
    const allBudgets = await prisma.budgetMensuel.findMany({
      where: {
        userId: session.user.id,
        categorie: { type: 'epargne_autre' },
      },
      include: { categorie: true },
    });

    // Pour chaque compte, trouver la catégorie correspondante et calculer le total auto
    const fondsDetails = comptes.map(compte => {
      // Correspondance nom compte ↔ nom catégorie
      const catCorrespondante = categories.find(c =>
        c.nom.toLowerCase().includes(compte.nom.toLowerCase().split(' ')[0]) ||
        compte.nom.toLowerCase().includes(c.nom.toLowerCase().split(' ')[0])
      );

      const totalAuto = catCorrespondante
        ? allBudgets
            .filter(b => b.categorieId === catCorrespondante.id)
            .reduce((s, b) => s + n(b.montantReel), 0)
        : 0;

      return {
        id: compte.id,
        nom: compte.nom,
        soldeManuel: n(compte.soldeActuel),
        soldeAuto: totalAuto,
        // Utiliser le solde manuel s'il est > 0, sinon calcul auto
        soldeEffectif: n(compte.soldeActuel) > 0 ? n(compte.soldeActuel) : totalAuto,
        ordre: compte.ordre,
      };
    });

    const totalFonds = fondsDetails.reduce((s, f) => s + f.soldeEffectif, 0);

    return NextResponse.json({ fonds: fondsDetails, totalFonds });

  } catch (e: any) {
    console.error('GET /api/fonds:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}

// PUT /api/fonds — Mettre à jour le solde manuel d'un compte
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { id, soldeManuel } = await req.json();

    await prisma.compteFonds.update({
      where: { id, userId: session.user.id },
      data: { soldeActuel: BigInt(soldeManuel ?? 0) },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
