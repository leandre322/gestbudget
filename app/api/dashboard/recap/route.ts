import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { estSortie } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // P88

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee       = parseInt(searchParams.get('annee') ?? String(new Date().getFullYear()));
    const moisCourant = parseInt(searchParams.get('mois')  ?? String(new Date().getMonth() + 1));
    const userId      = session.user.id;

    // Bornes dates de l'annee
    const dateDebut = new Date(`${annee}-01-01`);
    const dateFin   = new Date(`${annee}-12-31T23:59:59`);

    // 1. anneeRec + categories en parallele
    //    NOTE : on ne retourne PAS d'erreur si anneeRec est null.
    //    Le budget sera vide mais les decStats doivent toujours etre calcules.
    const [anneeRec, categories] = await Promise.all([
      prisma.annee.findUnique({
        where: { userId_annee: { userId, annee } },
      }),
      prisma.categorie.findMany({
        where:   { userId, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
    ]);

    // 2. Budget + decaissements + mouvements en parallele
    //    Budget        : requete seulement si anneeRec existe
    //    Decaissements : par relation annee si anneeRec existe,
    //                    sinon par createdAt annee (fallback)
    //    Mouvements    : toujours par dateOperation (independant de anneeRec)
    const [budgetRows, decaissements, mouvements] = await Promise.all([

      anneeRec
        ? prisma.budgetMensuel.findMany({
            where:   { userId, anneeId: anneeRec.id },
            include: { categorie: true },
          })
        : Promise.resolve([] as any[]),

      prisma.decaissement.findMany({
        where: anneeRec
          // Filtre relationnel standard (acces direct via anneeId)
          ? { userId, annee: { annee } }
          // Fallback si pas d'anneeRec : par date de creation
          : { userId, createdAt: { gte: dateDebut, lte: dateFin } },
        select: {
          typeMouvement: true,
          montantFond:   true,
          montantBanque: true,
          montantTotal:  true,
        },
      }),

      prisma.mouvementBanque.findMany({
        where: {
          userId,
          dateOperation: { gte: dateDebut, lte: dateFin },
        },
        select: {
          typeMouvement: true,
          montant:       true,
          dateOperation: true,
        },
      }),
    ]);

    // 3. Cumul budget par categorie (12 mois -> 1 ligne par categorie)
    const budgetCumul: Record<string, any> = {};
    for (const b of budgetRows) {
      if (!budgetCumul[b.categorieId]) {
        budgetCumul[b.categorieId] = {
          categorieId:     b.categorieId,
          categorie:       b.categorie,
          montantAnticipe: 0,
          montantReel:     0,
        };
      }
      budgetCumul[b.categorieId].montantAnticipe += Number(b.montantAnticipe ?? 0);
      budgetCumul[b.categorieId].montantReel     += Number(b.montantReel     ?? 0);
    }

    // 4. Historique 6 derniers mois (depenses uniquement)
    const MOIS_COURTS: Record<number, string> = {
      1:'Jan', 2:'Fev', 3:'Mar', 4:'Avr', 5:'Mai', 6:'Jun',
      7:'Jul', 8:'Aou', 9:'Sep', 10:'Oct', 11:'Nov', 12:'Dec',
    };
    const hist = [];
    for (let i = 5; i >= 0; i--) {
      let m = moisCourant - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      const rows = budgetRows.filter(b => b.mois === m);
      hist.push({
        mois: MOIS_COURTS[m],
        ant:  rows.filter(b => estSortie(b.categorie?.type)).reduce((s, b) => s + Number(b.montantAnticipe ?? 0), 0),
        reel: rows.filter(b => estSortie(b.categorie?.type)).reduce((s, b) => s + Number(b.montantReel     ?? 0), 0),
      });
    }

    // 5. Stats decaissements & mouvements banques (filtres par annee)
    const fondAjouts     = decaissements.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const fondRetraits   = decaissements.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + Number(d.montantFond || d.montantTotal || 0), 0);
    const banqueAjouts   = mouvements.filter(m => m.typeMouvement === 'ajout').reduce((s, m) => s + Number(m.montant || 0), 0);
    const banqueRetraits = mouvements.filter(m => m.typeMouvement === 'retrait').reduce((s, m) => s + Number(m.montant || 0), 0);

    return NextResponse.json(serial({
      budget:     Object.values(budgetCumul),
      categories,
      hist,
      decStats:   { fondAjouts, fondRetraits, banqueAjouts, banqueRetraits },
    }));
  } catch (e: any) {
    console.error('GET /api/dashboard/recap:', e?.message);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 }); // P113
  }
}
