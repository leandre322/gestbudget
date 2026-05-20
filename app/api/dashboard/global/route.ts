import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const annees = await prisma.annee.findMany({
      where: { userId: session.user.id },
      orderBy: { annee: 'asc' },
    });
    if (annees.length === 0) return NextResponse.json({ totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, solde: 0, evolutionAnnuelle: [], fondsRoulement: [], comptes: [], totalFonds: 0, annees: [] });

    const anneeIds = annees.map(a => a.id);
    const budgets = await prisma.budgetMensuel.findMany({
      where: { userId: session.user.id, anneeId: { in: anneeIds } },
      include: { categorie: true },
    });

    const totalRevenus  = budgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
    const totalDepenses = budgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
    const totalEpargne  = budgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
    const solde         = totalRevenus - totalDepenses - totalEpargne;

    const evolutionAnnuelle = annees.map(a => {
      const ab = budgets.filter(b => b.anneeId === a.id);
      return {
        annee: a.annee,
        revenus:  ab.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0),
        depenses: ab.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0),
        epargne:  ab.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0),
      };
    });

    const catsFonds = await prisma.categorie.findMany({
      where: { userId: session.user.id, type: 'epargne_autre', isActive: true },
      orderBy: { ordre: 'asc' },
    });
    const fondsRoulement = catsFonds.map(cat => ({
      id: cat.id, nom: cat.nom,
      totalAuto: budgets.filter(b => b.categorieId === cat.id).reduce((s, b) => s + n(b.montantReel), 0),
    }));

    const comptes = await prisma.compteFonds.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    return NextResponse.json({
      totalRevenus, totalDepenses, totalEpargne, solde,
      evolutionAnnuelle, fondsRoulement,
      comptes: comptes.map(c => ({ ...c, soldeActuel: n(c.soldeActuel) })),
      totalFonds: fondsRoulement.reduce((s, f) => s + f.totalAuto, 0),
      annees: annees.map(a => a.annee),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
