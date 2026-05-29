import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function serial(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(serial);
  if (typeof obj === 'object') {
    const r: any = {};
    for (const k of Object.keys(obj)) r[k] = serial(obj[k]);
    return r;
  }
  return obj;
}

// GET /api/comptes/evolution?id=xxx
// Retourne l'évolution du solde d'un fond sur les 12 derniers mois
// Données : contributions mensuelles (montantReel) + solde cumulatif
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const compteId = searchParams.get('id');
    if (!compteId) {
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });
    }

    // Vérifier que le compte appartient à l'utilisateur
    const compte = await prisma.compteFonds.findFirst({
      where: { id: compteId, userId: session.user.id },
      select: { id: true, nom: true, soldeActuel: true },
    });
    if (!compte) {
      return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
    }

    // Trouver les catégories liées à ce fond
    const catsLiees = await prisma.categorie.findMany({
      where: { userId: session.user.id, compteFondsId: compteId },
      select: { id: true, nom: true },
    });

    if (catsLiees.length === 0) {
      return NextResponse.json(serial({ compte, mois: [], catsLiees: [] }));
    }

    const catIds = catsLiees.map(c => c.id);

    // Construire les 12 derniers mois
    const now     = new Date();
    const moisData: {
      label: string;
      mois: number;
      annee: number;
      contribution: number;
      contributionAnticipee: number;
    }[] = [];

    const MOIS_COURTS = ['Jan','Fév','Mar','Avr','Mai','Jun',
                         'Jul','Aoû','Sep','Oct','Nov','Déc'];

    for (let i = 11; i >= 0; i--) {
      const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mois = d.getMonth() + 1;
      const annee = d.getFullYear();

      // Trouver l'anneeId pour cette année
      const anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId: session.user.id, annee } },
        select: { id: true },
      });

      let contribution         = 0;
      let contributionAnticipee = 0;

      if (anneeRec) {
        const budgets = await prisma.budgetMensuel.findMany({
          where: {
            userId:      session.user.id,
            anneeId:     anneeRec.id,
            categorieId: { in: catIds },
            mois,
          },
          select: { montantReel: true, montantAnticipe: true },
        });

        contribution          = budgets.reduce((s, b) => s + Number(b.montantReel ?? 0), 0);
        contributionAnticipee = budgets.reduce((s, b) => s + Number(b.montantAnticipe ?? 0), 0);
      }

      moisData.push({
        label:                `${MOIS_COURTS[mois - 1]} ${annee !== now.getFullYear() ? annee : ''}`.trim(),
        mois,
        annee,
        contribution,
        contributionAnticipee,
      });
    }

    // Calculer le solde cumulatif progressif
    // On part du solde actuel moins les contributions passées non incluses
    const totalContrib = moisData.reduce((s, m) => s + m.contribution, 0);
    let soldeRunning   = Number(compte.soldeActuel ?? 0);

    // Reconstruire le cumul en partant du début (12 mois en arrière)
    // Estimation : solde courant - somme des 12 mois = solde il y a 12 mois
    const soldeDeparture = soldeRunning - totalContrib;
    let cumul = soldeDeparture;

    const moisAvecCumul = moisData.map(m => {
      cumul += m.contribution;
      return { ...m, soldeCumulatif: cumul };
    });

    return NextResponse.json(serial({
      compte:   { ...compte },
      catsLiees,
      mois:     moisAvecCumul,
      soldeActuel: Number(compte.soldeActuel ?? 0),
    }));

  } catch (e: any) {
    console.error('GET /api/comptes/evolution:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur interne' }, { status: 500 });
  }
}
