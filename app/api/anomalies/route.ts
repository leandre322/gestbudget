import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const mois  = parseInt(searchParams.get('mois')  ?? '0');
    const annee = parseInt(searchParams.get('annee') ?? '0');
    if (!mois || !annee)
      return NextResponse.json({ error: 'mois et annee requis' }, { status: 400 });

    const params = await (prisma as any).parametres.findUnique({ where: { userId } });
    const seuilPct = params?.seuilAnomaliesPct ?? 50;

    const anneeRec = await prisma.annee.findFirst({ where: { userId, annee } });
    if (!anneeRec) return NextResponse.json({ anomalies: [] });

    const budgetCourant = await prisma.budgetMensuel.findMany({
      where:   { userId, anneeId: anneeRec.id, mois },
      include: { categorie: true },
    });

    // Charger les 3 mois precedents en batch
    const prevMois: { m: number; a: number }[] = [];
    for (let i = 1; i <= 3; i++) {
      let m = mois - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      prevMois.push({ m, a });
    }

    const prevBudgets: Record<string, Map<string, number>> = {};
    await Promise.all(prevMois.map(async ({ m, a }) => {
      const anneeP = await prisma.annee.findFirst({ where: { userId, annee: a } });
      if (!anneeP) return;
      const budget = await prisma.budgetMensuel.findMany({
        where: { userId, anneeId: anneeP.id, mois: m },
      });
      budget.forEach(b => {
        if (!prevBudgets[b.categorieId]) prevBudgets[b.categorieId] = new Map();
        prevBudgets[b.categorieId].set(`${a}-${m}`, Number(b.montantReel));
      });
    }));

    const anomalies = [];
    for (const ligne of budgetCourant.filter((b: any) =>
      b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette'
    )) {
      const reel = Number(ligne.montantReel);
      if (reel === 0) continue;
      const historique = Array.from(prevBudgets[ligne.categorieId]?.values() ?? []).filter(v => v > 0);
      if (historique.length === 0) continue;
      const moyenne = historique.reduce((s, v) => s + v, 0) / historique.length;
      const ecart   = Math.round(((reel - moyenne) / moyenne) * 100);
      if (ecart >= seuilPct) {
        anomalies.push({
          categorieId: ligne.categorieId,
          categorie:   (ligne as any).categorie.nom,
          montantReel: reel,
          moyenne:     Math.round(moyenne),
          ecartPct:    ecart,
        });
      }
    }

    anomalies.sort((a, b) => b.ecartPct - a.ecartPct);
    return NextResponse.json(serial({ anomalies }));
  } catch (e: any) {
    console.error('[anomalies]', e);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}