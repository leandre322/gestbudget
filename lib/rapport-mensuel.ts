import prisma from '@/lib/prisma';
import { envoyerRapportMensuel } from '@/lib/email';

/**
 * S8 - Rapport mensuel extrait de l'ancienne route /api/push/cron.
 *
 * Cette route n'etait declenchee par AUCUN cron Vercel : le rapport email
 * ne partait plus. Sa logique vit desormais ici et est appelee par
 * /api/cron/recurrentes-mensuelles (1er du mois), ce qui supprime un
 * endpoint expose et exempte de CSRF.
 *
 * S8 / Q5 : le filtre `rapportEmailJour: jourActuel` est ABANDONNE. Avec un
 * cron unique le 1er du mois, seuls les utilisateurs ayant regle ce parametre
 * sur 1 auraient recu un email — le parametre etait inoperant en pratique.
 * On envoie desormais a tous les `rapportEmailActif: true`.
 */

export type PeriodeRapport = { mois: number; annee: number; label: string };

// Mois PRECEDENT par rapport a la date d'execution.
// Janvier (getMonth() === 0) => decembre de l'annee precedente.
export function periodeMoisPrecedent(reference?: Date): PeriodeRapport {
  const d = reference ?? new Date();
  const mois = d.getMonth() === 0 ? 12 : d.getMonth();
  const annee = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const label = new Date(annee, mois - 1).toLocaleString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return { mois, annee, label };
}

export type ResultatRapports = {
  destinataires: number;
  emailsEnvoyes: number;
  erreurs: number;
};

export async function envoyerRapportsMensuels(
  periode: PeriodeRapport
): Promise<ResultatRapports> {
  const moisRapport = periode.mois;
  const anneeRapport = periode.annee;

  const parametresListe = await (prisma as any).parametres.findMany({
    where: { rapportEmailActif: true },
    include: { user: { select: { email: true, nom: true } } },
  });

  let emailsEnvoyes = 0;
  let erreurs = 0;

  await Promise.allSettled(
    parametresListe.map(async (params: any) => {
      try {
        const anneeRec = await prisma.annee.findFirst({
          where: { userId: params.userId, annee: anneeRapport },
        });
        if (!anneeRec) return;

        const budget = await prisma.budgetMensuel.findMany({
          where: { userId: params.userId, anneeId: anneeRec.id, mois: moisRapport },
          include: { categorie: true },
        });

        // Rule 22 : Number(bigint), jamais toString() sur les montants.
        const revenus = budget
          .filter((b: any) => b.categorie.type === 'revenu')
          .reduce((s: number, b: any) => s + Number(b.montantReel), 0);

        const depenses = budget
          .filter(
            (b: any) =>
              b.categorie.type.startsWith('depense') ||
              b.categorie.type === 'remboursement_dette'
          )
          .reduce((s: number, b: any) => s + Number(b.montantReel), 0);

        const epargne = budget
          .filter((b: any) => b.categorie.type.startsWith('epargne'))
          .reduce((s: number, b: any) => s + Number(b.montantReel), 0);

        const solde = revenus - depenses - epargne;

        const comptes = await prisma.compteFonds.findMany({
          where: { userId: params.userId, isActive: true },
        });
        const banques = await prisma.banque.findMany({
          where: { userId: params.userId, isActive: true },
        });
        const epargneFonctionnement = comptes.reduce(
          (s: number, c: any) => s + Number(c.soldeActuel),
          0
        );
        const epargneGlobale = banques.reduce(
          (s: number, b: any) => s + Number(b.solde),
          0
        );

        // Score simplifie (identique a l'ancienne route)
        const tauxEp = revenus > 0 ? (epargne / revenus) * 100 : 0;
        const tauxDep = revenus > 0 ? (depenses / revenus) * 100 : 0;
        let score = 10;
        if (tauxEp >= 20) score += 4;
        else if (tauxEp >= 10) score += 2;
        if (solde >= 0) score += 3;
        if (tauxDep <= 60) score += 3;
        score = Math.min(20, Math.max(0, score));

        // Anomalies vs mois precedent
        const seuilPct = params.seuilAnomaliesPct ?? 50;
        const moisPrev = moisRapport === 1 ? 12 : moisRapport - 1;
        const anneePrev = moisRapport === 1 ? anneeRapport - 1 : anneeRapport;
        const anomalies: { categorie: string; ecart: number }[] = [];

        const anneePrevRec = await prisma.annee.findFirst({
          where: { userId: params.userId, annee: anneePrev },
        });

        if (anneePrevRec) {
          const budgetPrev = await prisma.budgetMensuel.findMany({
            where: { userId: params.userId, anneeId: anneePrevRec.id, mois: moisPrev },
            include: { categorie: true },
          });
          const lignesDepense = budget.filter((b: any) =>
            b.categorie.type.startsWith('depense')
          );
          for (const ligne of lignesDepense) {
            const prev = budgetPrev.find(
              (p: any) => p.categorieId === (ligne as any).categorieId
            );
            if (!prev || Number(prev.montantReel) === 0) continue;
            const ecart = Math.round(
              ((Number((ligne as any).montantReel) - Number(prev.montantReel)) /
                Number(prev.montantReel)) *
                100
            );
            if (ecart >= seuilPct) {
              anomalies.push({ categorie: (ligne as any).categorie.nom, ecart });
            }
          }
          anomalies.sort((a, b) => b.ecart - a.ecart);
        }

        await envoyerRapportMensuel({
          destinataire: params.user.email,
          nom: params.user.nom ?? undefined,
          mois: moisRapport,
          annee: anneeRapport,
          score,
          revenus,
          depenses,
          epargne,
          solde,
          epargneFonctionnement,
          epargneGlobale,
          anomalies: anomalies.slice(0, 3),
        });

        emailsEnvoyes++;
      } catch (e) {
        erreurs++;
        console.error('[rapport-mensuel] erreur utilisateur', params.userId, e);
      }
    })
  );

  return {
    destinataires: parametresListe.length,
    emailsEnvoyes,
    erreurs,
  };
}