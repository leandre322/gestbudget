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
      where:   { userId: session.user.id },
      orderBy: { annee: 'asc' },
    });

    if (annees.length === 0) return NextResponse.json({
      totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, solde: 0,
      evolutionAnnuelle: [], fondsRoulement: [], comptes: [], totalFonds: 0,
      annees: [], banques: [], revenuReference: 0, scoreGlobal: 0, nbMoisScore: 0,
    });

    const anneeIds = annees.map(a => a.id);

    const [budgets, catsFonds, comptes, banques, parametres] = await Promise.all([
      prisma.budgetMensuel.findMany({
        where:   { userId: session.user.id, anneeId: { in: anneeIds } },
        include: { categorie: true },
      }),
      prisma.categorie.findMany({
        where:   { userId: session.user.id, type: 'epargne_autre', isActive: true },
        orderBy: { ordre: 'asc' },
      }),
      prisma.compteFonds.findMany({
        where:   { userId: session.user.id, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
      prisma.banque.findMany({
        where:   { userId: session.user.id, mois: null, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
      prisma.parametres.findUnique({
        where: { userId: session.user.id },
      }),
    ]);

    // ── Totaux globaux ──
    const totalRevenus  = budgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
    const totalDepenses = budgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
    const totalEpargne  = budgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
    const solde         = totalRevenus - totalDepenses - totalEpargne;

    // ── Évolution annuelle ──
    const evolutionAnnuelle = annees.map(a => {
      const ab = budgets.filter(b => b.anneeId === a.id);
      return {
        annee:    a.annee,
        revenus:  ab.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0),
        depenses: ab.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0),
        epargne:  ab.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0),
      };
    });

    // ── Fonds de roulement ──
    const fondsRoulement = catsFonds.map(cat => ({
      id:        cat.id,
      nom:       cat.nom,
      totalAuto: budgets.filter(b => b.categorieId === cat.id).reduce((s, b) => s + n(b.montantReel), 0),
    }));

    // ── Banques ──
    const banquesUniques = banques.map(b => ({
      id:          b.id,
      nomBanque:   b.nomBanque,
      typeCompte:  b.typeCompte,
      solde:       n(b.solde),
      ordre:       b.ordre,
    }));

    // ── Revenu de référence ──
    const revenuReference = n((parametres as any)?.revenuMensuelReference ?? 0);

    // ── Score global — moyenne pondérée toutes années ──
    let totalScore = 0;
    let nbMoisScore = 0;
    try {
      const fondsUrgenceObjectif = revenuReference > 0 ? revenuReference * 6 : 3720000;
      for (const anneeRec of annees) {
        for (let m = 1; m <= 12; m++) {
          const budgetsMois = budgets.filter(b =>
            b.anneeId === anneeRec.id && Number(b.mois) === m
          );
          if (budgetsMois.length === 0) continue;
          const totRev = budgetsMois.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
          if (totRev === 0) continue;
          const totDep    = budgetsMois.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
          const totDepAnt = budgetsMois.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantAnticipe), 0);
          const totEp     = budgetsMois.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
          const totFU     = budgetsMois.filter(b => b.categorie.type === 'epargne_precaution').reduce((s, b) => s + n(b.montantReel), 0);
          const soldeMois = totRev - totDep - totEp;
          let scoreMois   = 0;
          if (totDepAnt > 0) scoreMois += Math.min(5, (totDepAnt / Math.max(totDep, 1)) * 5);
          else scoreMois += 3;
          scoreMois += Math.min(5, ((totRev > 0 ? totEp / totRev : 0) / 0.30) * 5);
          scoreMois += soldeMois >= 0 ? 5 : Math.max(0, 5 + (soldeMois / totRev) * 5);
          scoreMois += Math.min(5, ((fondsUrgenceObjectif > 0 ? totFU / fondsUrgenceObjectif : 0) / 0.5) * 5);
          totalScore  += Math.round(scoreMois);
          nbMoisScore++;
        }
      }
    } catch (scoreErr) {
      console.error('Score calculation error:', scoreErr);
    }
    const scoreGlobal = nbMoisScore > 0 ? Math.round(totalScore / nbMoisScore) : 0;

    return NextResponse.json({
      totalRevenus,
      totalDepenses,
      totalEpargne,
      solde,
      evolutionAnnuelle,
      fondsRoulement,
      comptes:     comptes.map(c => ({ ...c, soldeActuel: n(c.soldeActuel) })),
      totalFonds:  fondsRoulement.reduce((s, f) => s + f.totalAuto, 0),
      annees:      annees.map(a => a.annee),
      banques:     banquesUniques,
      revenuReference,
      scoreGlobal,
      nbMoisScore,
    });

  } catch (e: any) {
    console.error('API global error:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}