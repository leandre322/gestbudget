import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const annees = await prisma.annee.findMany({
      where:   { userId: session.user.id },
      orderBy: { annee: 'asc' },
    });

    if (annees.length === 0) {
      return NextResponse.json({
        totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, solde: 0,
        evolutionAnnuelle: [], fondsRoulement: [], comptes: [], totalFonds: 0,
        annees: [], banques: [], revenuReference: 0, nMoisUrgence: 6,
        scoreGlobal: 0, nbMoisScore: 0,
        totalAjouts: 0, totalDecaissements: 0, soldeNetDecaissements: 0,
      });
    }

    const anneeIds = annees.map(a => a.id);

    // ── Requêtes principales ──────────────────────────────────────────────
    const [budgets, comptes, banques, decaissements] = await Promise.all([
      prisma.budgetMensuel.findMany({
        where:   { userId: session.user.id, anneeId: { in: anneeIds } },
        include: { categorie: true },
      }),
      prisma.compteFonds.findMany({
        where:   { userId: session.user.id, isActive: true },
        orderBy: { ordre: 'asc' },
      }),
      prisma.banque.findMany({
        where:   { userId: session.user.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.decaissement.findMany({
        where:   { userId: session.user.id },
        include: { repartitions: true },
      }),
    ]);

    // ── Paramètres isolés ────────────────────────────────────────────────
    let parametres: any = null;
    try {
      parametres = await prisma.parametres.findUnique({
        where: { userId: session.user.id },
      });
    } catch (e) {
      console.error('Parametres query error:', e);
    }

    // ── Totaux globaux budget ────────────────────────────────────────────
    const totalRevenus  = budgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
    const totalDepenses = budgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
    const totalEpargne  = budgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
    const solde = totalRevenus - totalDepenses - totalEpargne;

    // ── Décaissements globaux ────────────────────────────────────────────
    const totalAjouts        = decaissements.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + n(d.montantTotal), 0);
    const totalDecaissements = decaissements.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + n(d.montantTotal), 0);
    const soldeNetDecaissements = totalAjouts - totalDecaissements;

    // ── Évolution annuelle ────────────────────────────────────────────────
    const evolutionAnnuelle = annees.map(a => {
      const ab = budgets.filter(b => b.anneeId === a.id);
      return {
        annee:    a.annee,
        revenus:  ab.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0),
        depenses: ab.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0),
        epargne:  ab.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0),
      };
    });

    // ── Fonds de roulement — source unifiée ──────────────────────────────
    // Épargné   = budget_mensuel epargne_autre (ce que l'utilisateur saisit dans Suivi)
    // Ajouté    = décaissements typeMouvement='ajout' par compte
    // Décaissé  = décaissements typeMouvement='retrait' par compte
    // Solde net = soldeActuel (maintenu par les décaissements)
    const budgetsEpargneAutre = budgets.filter(b => b.categorie.type === 'epargne_autre');

    const fondsRoulement = comptes.map(c => {
      // Décaissements rattachés à ce compte via repartitions
      const ajoutsCompte = decaissements
        .filter(d => d.typeMouvement === 'ajout')
        .reduce((s, d) => {
          const rep = d.repartitions.find(r => r.compteId === c.id);
          return s + (rep ? n(rep.montant) : 0);
        }, 0);

      const decaisseCompte = decaissements
        .filter(d => d.typeMouvement === 'retrait')
        .reduce((s, d) => {
          const rep = d.repartitions.find(r => r.compteId === c.id);
          return s + (rep ? n(rep.montant) : 0);
        }, 0);

      // Budget épargné — catégories epargne_autre dont le nom correspond au fond
      // Correspondance souple : le nom du fond est contenu dans le nom de la catégorie
      const totalBudgete = budgetsEpargneAutre
        .filter(b =>
          b.categorie.nom.toLowerCase().includes(c.nom.toLowerCase()) ||
          c.nom.toLowerCase().includes(b.categorie.nom.toLowerCase())
        )
        .reduce((s, b) => s + n(b.montantReel), 0);

      return {
        id:           c.id,
        nom:          c.nom,
        soldeActuel:  n(c.soldeActuel),   // source de vérité = solde réel
        totalBudgete,                      // ce qui a été saisi dans Suivi
        totalAjout:   ajoutsCompte,        // ajouts via décaissements
        totalDecaisse: decaisseCompte,     // retraits via décaissements
      };
    });

    const totalFonds = fondsRoulement.reduce((s, f) => s + f.soldeActuel, 0);

    // ── Banques — déduplication ──────────────────────────────────────────
    const vus = new Set<string>();
    const banquesUniques = banques.reduce((acc: any[], b) => {
      if (!vus.has(b.nomBanque)) {
        vus.add(b.nomBanque);
        acc.push({ id: b.id, nomBanque: b.nomBanque, typeCompte: b.typeCompte, solde: n(b.solde) });
      }
      return acc;
    }, []);

    // ── Paramètres ───────────────────────────────────────────────────────
    const revenuReference = n(parametres?.revenuMensuelReference ?? 0);
    const nMoisUrgence    = (parametres as any)?.nMoisUrgence ?? 6;

    // ── Score global ─────────────────────────────────────────────────────
    let totalScore = 0, nbMoisScore = 0;
    try {
      const totalBanques         = banquesUniques.reduce((s, b) => s + b.solde, 0);
      const fondsUrgenceObjectif = revenuReference > 0 ? revenuReference * nMoisUrgence : 3720000;
      for (const anneeRec of annees) {
        for (let m = 1; m <= 12; m++) {
          const bm = budgets.filter(b => b.anneeId === anneeRec.id && Number(b.mois) === m);
          if (!bm.length) continue;
          const totRev = bm.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
          if (totRev === 0) continue;
          const totDep    = bm.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
          const totDepAnt = bm.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantAnticipe), 0);
          const totEp     = bm.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
          const soldeMois = totRev - totDep - totEp;
          let sc = 0;
          sc += totDepAnt > 0 ? Math.min(5, (totDepAnt / Math.max(totDep, 1)) * 5) : 3;
          sc += Math.min(5, ((totRev > 0 ? totEp / totRev : 0) / 0.30) * 5);
          sc += soldeMois >= 0 ? 5 : Math.max(0, 5 + (soldeMois / totRev) * 5);
          sc += Math.min(5, ((fondsUrgenceObjectif > 0 ? totalBanques / fondsUrgenceObjectif : 0) / 0.5) * 5);
          totalScore += Math.round(sc);
          nbMoisScore++;
        }
      }
    } catch (e) { console.error('Score error:', e); }
    const scoreGlobal = nbMoisScore > 0 ? Math.round(totalScore / nbMoisScore) : 0;

    return NextResponse.json({
      totalRevenus, totalDepenses, totalEpargne, solde,
      evolutionAnnuelle,
      fondsRoulement,
      comptes:            comptes.map(c => ({ id: c.id, nom: c.nom, soldeActuel: n(c.soldeActuel) })),
      totalFonds,
      annees:             annees.map(a => a.annee),
      banques:            banquesUniques,
      revenuReference,
      nMoisUrgence,
      scoreGlobal,
      nbMoisScore,
      totalAjouts,
      totalDecaissements,
      soldeNetDecaissements,
    });

  } catch (e: any) {
    console.error('API global error:', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
