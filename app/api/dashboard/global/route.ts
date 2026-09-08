import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { calculerScore, estSortie, estEpargne } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// S12 — refonte. Defauts corriges :
//
//  P7  fondsUrgenceObjectif retombait sur || 3720000 quand revenuReference
//      valait 0. Ce nombre en dur gonflait artificiellement la 4e composante
//      du score et constituait une 3e source pour l'objectif d'urgence, en
//      concurrence avec parametres et annees.fondsUrgenceObjectif (deprecie).
//      Desormais : objectif 0 et scoreGlobal null, etat "non configure".
//  P11 L'appariement fonds <-> categorie se faisait par INCLUSION DE NOM dans
//      les deux sens. "Sante" matchait "Assurance sante" et inversement.
//      Categorie.compteFondsId existe : on l'utilise.
//  P12 La deduplication par nomBanque masquait 3 des 4 comptes BOA, donc
//      fausse le total et le score. Toutes les banques actives sont renvoyees.
//  P19 include: { categorie: true } dupliquait l'objet categorie complet sur
//      chaque ligne de budget. select cible + Map des categories.
//  P20 Le score faisait budgets.filter() dans une boucle 12 x nbAnnees, soit
//      ~36 parcours complets du tableau. Indexation unique en Map.
//  P21 Le calcul par fonds refaisait filter().reduce() avec un find() interne
//      pour chaque compte : O(comptes x decaissements x repartitions).
//      Une seule passe construit la Map.
//  P22 La requete parametres etait hors du Promise.all (aller-retour Neon
//      sequentiel) et son catch avalait l'erreur en silence.
//  P23 orderBy updatedAt rendait l'ordre dependant de la derniere ecriture.
//
// M5/M6/M7 — perimetre du fonds d'urgence
//   Le denominateur du 4e critere de score etait la somme de TOUTES les
//   banques. Il est desormais borne aux comptes compteUrgence = true.
//   Consequence attendue et validee : 80 059 au lieu de 980 059.
//
// Q25 — non double comptage (regle posee dans schema.prisma / M8)
//   Un fonds adosse a une banque (banqueId non nul) voit son argent compte
//   par la banque. totalFonds reste inchange pour ne pas deplacer l'affichage
//   existant sans arbitrage ; totalFondsAutonome expose la valeur correcte.
// ─────────────────────────────────────────────────────────────────────────────

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

// I36 -- la classification vit dans types/index.ts, plus de copie locale.

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });
    }
    const userId = session.user.id;

    const annees = await prisma.annee.findMany({
      where:   { userId },
      orderBy: { annee: 'asc' },
    });

    if (annees.length === 0) {
      return NextResponse.json({
        totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, solde: 0,
        evolutionAnnuelle: [], fondsRoulement: [], comptes: [],
        totalFonds: 0, totalFondsAutonome: 0,
        annees: [], banques: [],
        revenuReference: 0, nMoisUrgence: 6,
        fondsUrgence: 0, fondsUrgenceObjectif: 0, urgenceConfigure: false,
        totalBanques: 0,
        scoreGlobal: null, nbMoisScore: 0,
        totalAjouts: 0, totalDecaissements: 0, soldeNetDecaissements: 0,
      });
    }

    const anneeIds = annees.map(a => a.id);

    // ── P19 / P22 : tout en parallele, colonnes ciblees ───────────────────
    const [budgets, categories, comptes, banques, decaissements, parametres] =
      await Promise.all([
        prisma.budgetMensuel.findMany({
          where:  { userId, anneeId: { in: anneeIds } },
          select: {
            anneeId: true, categorieId: true, mois: true,
            montantReel: true, montantAnticipe: true,
          },
        }),
        prisma.categorie.findMany({
          where:  { userId },
          select: { id: true, nom: true, type: true, compteFondsId: true, banqueId: true },
        }),
        prisma.compteFonds.findMany({
          where:   { userId, isActive: true },
          orderBy: [{ ordre: 'asc' }, { id: 'asc' }],
          select:  { id: true, nom: true, soldeActuel: true, objectif: true, seuilAlerte: true, banqueId: true },
        }),
        // P12 : plus de dedup par nom. P23 : tri stable.
        // Q15 : les banques desactivees sortent du patrimoine.
        prisma.banque.findMany({
          where:   { userId, isActive: true },
          orderBy: [{ ordre: 'asc' }, { id: 'asc' }],
          select:  {
            id: true, nomBanque: true, typeCompte: true, solde: true,
            seuilAlerte: true, compteUrgence: true,
          },
        }),
        prisma.decaissement.findMany({
          where:  { userId },
          select: {
            typeMouvement: true, montantTotal: true,
            repartitions: { select: { compteId: true, montant: true } },
          },
        }),
        // P22 : dans le Promise.all, et l'erreur remonte au lieu d'etre avalee.
        prisma.parametres.findUnique({ where: { userId } }),
      ]);

    // ── P19 : index des types de categorie ───────────────────────────────
    const typeParCat = new Map<string, string>();
    const catParId   = new Map<string, any>();
    for (const c of categories) {
      typeParCat.set(c.id, c.type as string);
      catParId.set(c.id, c);
    }

    // ── P20 : une seule passe pour tous les agregats ─────────────────────
    // Avant : 3 filter().reduce() pour les totaux, 3 de plus par annee, puis
    // 4 de plus par (annee, mois). Ici chaque ligne est visitee une fois.
    let totalRevenus = 0, totalDepenses = 0, totalEpargne = 0;

    const parAnnee = new Map<string, { revenus: number; depenses: number; epargne: number }>();
    for (const id of anneeIds) parAnnee.set(id, { revenus: 0, depenses: 0, epargne: 0 });

    type AggMois = { rev: number; dep: number; depAnt: number; ep: number };
    const parMois = new Map<string, AggMois>();

    // P11 : totaux epargne_autre par compteFondsId (plus de match par nom)
    const budgeteParFonds = new Map<string, number>();

    for (const b of budgets) {
      const type = typeParCat.get(b.categorieId);
      if (!type) continue;   // categorie absente : ligne orpheline, ignoree

      const reel = n(b.montantReel);
      const ant  = n(b.montantAnticipe);

      const estDep = estSortie(type);
      const estEp  = estEpargne(type);
      const estRev = type === 'revenu';

      if (estRev)      { totalRevenus  += reel; }
      else if (estDep) { totalDepenses += reel; }
      else if (estEp)  { totalEpargne  += reel; }

      const a = parAnnee.get(b.anneeId);
      if (a) {
        if (estRev)      a.revenus  += reel;
        else if (estDep) a.depenses += reel;
        else if (estEp)  a.epargne  += reel;
      }

      const cle = b.anneeId + '-' + Number(b.mois);
      let m = parMois.get(cle);
      if (!m) { m = { rev: 0, dep: 0, depAnt: 0, ep: 0 }; parMois.set(cle, m); }
      if (estRev)      m.rev += reel;
      else if (estDep) { m.dep += reel; m.depAnt += ant; }
      else if (estEp)  m.ep  += reel;

      if (type === 'epargne_autre') {
        const cat = catParId.get(b.categorieId);
        if (cat?.compteFondsId) {
          budgeteParFonds.set(
            cat.compteFondsId,
            (budgeteParFonds.get(cat.compteFondsId) ?? 0) + reel,
          );
        }
      }
    }

    const solde = totalRevenus - totalDepenses - totalEpargne;

    const evolutionAnnuelle = annees.map(a => {
      const agg = parAnnee.get(a.id)!;
      return { annee: a.annee, revenus: agg.revenus, depenses: agg.depenses, epargne: agg.epargne };
    });

    // ── P21 : decaissements, une seule passe ─────────────────────────────
    let totalAjouts = 0, totalDecaissementsMt = 0;
    const mvtParFonds = new Map<string, { ajouts: number; retraits: number }>();

    for (const d of decaissements) {
      const estAjout = d.typeMouvement === 'ajout';
      if (estAjout) totalAjouts += n(d.montantTotal);
      else if (d.typeMouvement === 'retrait') totalDecaissementsMt += n(d.montantTotal);

      for (const r of d.repartitions) {
        let e = mvtParFonds.get(r.compteId);
        if (!e) { e = { ajouts: 0, retraits: 0 }; mvtParFonds.set(r.compteId, e); }
        if (estAjout) e.ajouts   += n(r.montant);
        else          e.retraits += n(r.montant);
      }
    }
    const soldeNetDecaissements = totalAjouts - totalDecaissementsMt;

    // ── Fonds ────────────────────────────────────────────────────────────
    const fondsRoulement = comptes.map(c => {
      const mvt = mvtParFonds.get(c.id) ?? { ajouts: 0, retraits: 0 };
      return {
        id:            c.id,
        nom:           c.nom,
        soldeActuel:   n(c.soldeActuel),
        objectif:      n(c.objectif),
        seuilAlerte:   n(c.seuilAlerte),   // cible de reconstitution du coach (cran 1)
        banqueId:      c.banqueId,         // non nul = fonds adosse a une banque
        totalBudgete:  budgeteParFonds.get(c.id) ?? 0,
        totalAjout:    mvt.ajouts,
        totalDecaisse: mvt.retraits,
      };
    });

    const totalFonds = fondsRoulement.reduce((s, f) => s + f.soldeActuel, 0);
    // Q25 : hors fonds adosses, dont l'argent est deja compte par la banque.
    const totalFondsAutonome = fondsRoulement
      .filter(f => !f.banqueId)
      .reduce((s, f) => s + f.soldeActuel, 0);

    // ── Banques ──────────────────────────────────────────────────────────
    const banquesOut = banques.map(b => ({
      id:            b.id,
      nomBanque:     b.nomBanque,
      typeCompte:    b.typeCompte,
      solde:         n(b.solde),
      seuilAlerte:   n(b.seuilAlerte),
      compteUrgence: b.compteUrgence,
    }));

    const totalBanques = banquesOut.reduce((s, b) => s + b.solde, 0);
    // M7 : perimetre resserre. Les comptes adosses a un placement en sont
    // exclus (BOA-CmpteEpargneLeo et consorts, compteUrgence = false).
    const fondsUrgence = banquesOut
      .filter(b => b.compteUrgence)
      .reduce((s, b) => s + b.solde, 0);

    // ── Parametres ───────────────────────────────────────────────────────
    const revenuReference = n(parametres?.revenuMensuelReference ?? 0);
    const nMoisUrgence    = parametres?.nMoisUrgence ?? 6;

    // P7 : plus de fallback en dur. Objectif nul = objectif non configure.
    const fondsUrgenceObjectif = revenuReference > 0 ? revenuReference * nMoisUrgence : 0;
    const urgenceConfigure     = fondsUrgenceObjectif > 0;

    // ── Score global ─────────────────────────────────────────────────────
    // Q19 : sans objectif d'urgence, le 4e critere n'a pas de denominateur.
    // Noter un mois sur 15 points en pretendant qu'il en vaut 20 serait
    // trompeur : on renvoie null et le front affiche "non configure".
    let scoreGlobal: number | null = null;
    let nbMoisScore = 0;
    let totalScore  = 0;

    for (const anneeRec of annees) {
      for (let m = 1; m <= 12; m++) {
        const agg = parMois.get(anneeRec.id + '-' + m);
        if (!agg || agg.rev === 0) continue;
        nbMoisScore++;
        if (!urgenceConfigure) continue;

        // P110 / Q168 -- source unique. La formule inline divergeait sur deux
        // criteres (respect du budget, solde negatif) et notait donc le meme
        // mois autrement que la jauge du Dashboard mensuel.
        totalScore += calculerScore({
          totalDepenses: agg.dep,
          totalDepAnt:   agg.depAnt,
          totalEpargne:  agg.ep,
          totalRevenus:  agg.rev,
          solde:         agg.rev - agg.dep - agg.ep,
          fondsUrgence,
          fondsObjectif: fondsUrgenceObjectif,
        }).score;
      }
    }
    if (urgenceConfigure && nbMoisScore > 0) {
      scoreGlobal = Math.round(totalScore / nbMoisScore);
    }

    return NextResponse.json({
      totalRevenus, totalDepenses, totalEpargne, solde,
      evolutionAnnuelle,
      fondsRoulement,
      comptes: comptes.map(c => ({
        id: c.id, nom: c.nom, soldeActuel: n(c.soldeActuel), banqueId: c.banqueId,
      })),
      totalFonds,
      totalFondsAutonome,
      annees: annees.map(a => a.annee),
      banques: banquesOut,
      revenuReference,
      nMoisUrgence,
      fondsUrgence,
      fondsUrgenceObjectif,
      urgenceConfigure,
      totalBanques,
      scoreGlobal,
      nbMoisScore,
      totalAjouts,
      totalDecaissements: totalDecaissementsMt,
      soldeNetDecaissements,
    });

  } catch (e: any) {
    console.error('GET /api/dashboard/global:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}