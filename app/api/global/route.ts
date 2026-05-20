import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

// GET /api/global — Cumul toutes années
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Toutes les années de l'utilisateur
    const annees = await prisma.annee.findMany({
      where: { userId: session.user.id },
      orderBy: { annee: 'asc' },
    });

    // Tout le budget mensuel (toutes années confondues)
    const allBudgets = await prisma.budgetMensuel.findMany({
      where: { userId: session.user.id },
      include: { categorie: true },
    });

    // KPIs cumulés
    const totalRevenus  = allBudgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
    const totalEpargne  = allBudgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
    const totalDepenses = allBudgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
    const soldeCumul    = totalRevenus - totalEpargne - totalDepenses;

    // Anticipé cumulé
    const totalRevenus_ant  = allBudgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantAnticipe), 0);
    const totalEpargne_ant  = allBudgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantAnticipe), 0);
    const totalDepenses_ant = allBudgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantAnticipe), 0);

    // Fonds de roulement — somme épargnes réelles par catégorie
    const fondsCategories = ['Rentrée Enfants', 'Santé', 'Entretien Voiture', 'Fête / Vacances'];
    const fonds = fondsCategories.map(nom => {
      const total = allBudgets
        .filter(b => b.categorie.nom === nom || b.categorie.nom.toLowerCase().includes(nom.toLowerCase().split(' ')[0].toLowerCase()))
        .reduce((s, b) => s + n(b.montantReel), 0);
      return { nom, total };
    });

    // Fonds d'urgence (épargne précaution cumulée)
    const fondsUrgenceCumul = allBudgets
      .filter(b => b.categorie.type === 'epargne_precaution')
      .reduce((s, b) => s + n(b.montantReel), 0);

    // Par année (pour graphique historique)
    const parAnnee = annees.map(a => {
      const budgetsAnnee = allBudgets.filter(b => b.anneeId === a.id);
      const rev = budgetsAnnee.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
      const dep = budgetsAnnee.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
      const ep  = budgetsAnnee.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
      return { annee: a.annee, revenus: rev, depenses: dep, epargne: ep, solde: rev - dep - ep };
    });

    return NextResponse.json({
      kpis: {
        totalRevenus, totalRevenus_ant,
        totalEpargne, totalEpargne_ant,
        totalDepenses, totalDepenses_ant,
        soldeCumul,
        fondsUrgenceCumul,
      },
      fonds,
      parAnnee,
      annees: annees.map(a => a.annee),
    });

  } catch (e: any) {
    console.error('GET /api/global:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
