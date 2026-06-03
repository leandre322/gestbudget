import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? String(new Date().getFullYear()));
    const moisCourant = parseInt(searchParams.get('mois') ?? String(new Date().getMonth() + 1));

    // 1. Annee record
    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });
    if (!anneeRec) return NextResponse.json({ budget: [], categories: [], hist: [], decStats: { fondAjouts: 0, fondRetraits: 0, banqueAjouts: 0, banqueRetraits: 0 } });

    // 2. Budget 12 mois en une seule requete
    const [budgetRows, categories, decaissements, mouvements] = await Promise.all([
      prisma.budgetMensuel.findMany({
        where:   { userId: session.user.id, anneeId: anneeRec.id },
        include: { categorie: true },
      }),
      prisma.categorie.findMany({
        where:   { userId: session.user.id, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
      prisma.decaissement.findMany({
        where: { userId: session.user.id, annee: { annee } },
        select: { typeMouvement: true, montantFond: true, montantBanque: true, montantTotal: true },
      }),
      prisma.mouvementBanque.findMany({
        where: {
          userId: session.user.id,
          dateOperation: {
            gte: new Date(`${annee}-01-01`),
            lte: new Date(`${annee}-12-31`),
          },
        },
        select: { typeMouvement: true, montant: true, dateOperation: true },
      }),
    ]);

    // 3. Cumul budget par categorie
    const budgetCumul: Record<string, any> = {};
    for (const b of budgetRows) {
      if (!budgetCumul[b.categorieId]) {
        budgetCumul[b.categorieId] = {
          categorieId:    b.categorieId,
          categorie:      b.categorie,
          montantAnticipe: 0,
          montantReel:     0,
        };
      }
      budgetCumul[b.categorieId].montantAnticipe += Number(b.montantAnticipe ?? 0);
      budgetCumul[b.categorieId].montantReel     += Number(b.montantReel     ?? 0);
    }

    // 4. Historique 6 derniers mois (depenses)
    const MOIS_COURTS: Record<number,string> = {1:'Jan',2:'Fev',3:'Mar',4:'Avr',5:'Mai',6:'Jun',7:'Jul',8:'Aou',9:'Sep',10:'Oct',11:'Nov',12:'Dec'};
    const hist = [];
    for (let i = 5; i >= 0; i--) {
      let m = moisCourant - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      const rows = budgetRows.filter(b => b.mois === m);
      const ant = rows.filter(b => b.categorie?.type?.startsWith('depense')).reduce((s, b) => s + Number(b.montantAnticipe ?? 0), 0);
      const reel = rows.filter(b => b.categorie?.type?.startsWith('depense')).reduce((s, b) => s + Number(b.montantReel ?? 0), 0);
      hist.push({ mois: MOIS_COURTS[m], ant, reel });
    }

    // 5. Stats decaissements
    const fondAjouts    = decaissements.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const fondRetraits  = decaissements.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const banqueAjouts  = mouvements.filter(m => m.typeMouvement === 'ajout').reduce((s, m) => s + Number(m.montant || 0), 0);
    const banqueRetraits = mouvements.filter(m => m.typeMouvement === 'retrait').reduce((s, m) => s + Number(m.montant || 0), 0);

    return NextResponse.json(serial({
      budget:     Object.values(budgetCumul),
      categories,
      hist,
      decStats:   { fondAjouts, fondRetraits, banqueAjouts, banqueRetraits },
    }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}