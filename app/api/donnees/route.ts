import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

// DELETE /api/donnees?annee=2027 — Supprimer toute une année
// DELETE /api/donnees?annee=2027&mois=3 — Supprimer un mois
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? '0');
    const mois  = searchParams.get('mois') ? parseInt(searchParams.get('mois')!) : null;

    if (!annee) return NextResponse.json({ error: 'Année requise' }, { status: 400 });

    // Trouver l'enregistrement année
    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });

    if (!anneeRec) return NextResponse.json({ error: 'Année introuvable' }, { status: 404 });

    if (mois) {
      // Supprimer un mois spécifique
      const deleted = await prisma.budgetMensuel.deleteMany({
        where: {
          userId:  session.user.id,
          anneeId: anneeRec.id,
          mois,
        },
      });
      return NextResponse.json({
        success: true,
        message: `${deleted.count} entrée(s) supprimée(s) pour ${annee}/${mois}`,
        count: deleted.count,
      });
    } else {
      // Supprimer toute l'année
      const deletedBudget = await prisma.budgetMensuel.deleteMany({
        where: { userId: session.user.id, anneeId: anneeRec.id },
      });
      const deletedDecaissements = await prisma.decaissement.deleteMany({
        where: { userId: session.user.id, anneeId: anneeRec.id },
      });
      await prisma.annee.delete({
        where: { id: anneeRec.id },
      });
      return NextResponse.json({
        success: true,
        message: `Année ${annee} supprimée (${deletedBudget.count} entrées budget, ${deletedDecaissements.count} décaissements)`,
        count: deletedBudget.count + deletedDecaissements.count,
      });
    }
  } catch (e: any) {
    console.error('DELETE /api/donnees:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// GET /api/donnees — Liste des années avec stats
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const annees = await prisma.annee.findMany({
      where: { userId: session.user.id },
      orderBy: { annee: 'asc' },
    });

    const stats = await Promise.all(annees.map(async a => {
      const moisAvecDonnees = await prisma.budgetMensuel.findMany({
        where:  { userId: session.user.id, anneeId: a.id },
        select: { mois: true },
        distinct: ['mois'],
      });
      const nbDecaissements = await prisma.decaissement.count({
        where: { userId: session.user.id, anneeId: a.id },
      });
      return {
        id:              a.id,
        annee:           a.annee,
        nbMois:          moisAvecDonnees.length,
        moisAvecDonnees: moisAvecDonnees.map(m => m.mois).sort(),
        nbDecaissements,
      };
    }));

    return NextResponse.json({ annees: stats });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}