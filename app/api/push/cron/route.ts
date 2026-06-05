import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendPushToUser } from '@/lib/push';
import { envoyerRapportMensuel } from '@/lib/email';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
    }

    const maintenant    = new Date();
    const moisRapport   = maintenant.getMonth() === 0 ? 12 : maintenant.getMonth();
    const anneeRapport  = maintenant.getMonth() === 0 ? maintenant.getFullYear() - 1 : maintenant.getFullYear();
    const moisLabel     = new Date(anneeRapport, moisRapport - 1).toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

    // 1 — Push notifications
    const subs = await prisma.pushSubscription.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });

    await Promise.allSettled(subs.map(s =>
      sendPushToUser(s.userId, {
        title: 'Rappel mensuel GestBudget',
        body:  'Pensez a saisir votre suivi de ' + moisLabel,
        icon:  '/icons/icon-192.png',
        url:   '/suivi',
        tag:   'rappel-mensuel',
      })
    ));

    // 2 — Rapports email
    const parametresListe = await (prisma as any).parametres.findMany({
      where:   { rapportEmailActif: true },
      include: { user: { select: { email: true, nom: true } } },
    });

    let emailsEnvoyes = 0;

    await Promise.allSettled(parametresListe.map(async (params: any) => {
      try {
        const anneeRec = await prisma.annee.findFirst({
          where: { userId: params.userId, annee: anneeRapport },
        });
        if (!anneeRec) return;

        const budget = await prisma.budgetMensuel.findMany({
          where:   { userId: params.userId, anneeId: anneeRec.id, mois: moisRapport },
          include: { categorie: true },
        });

        const revenus  = budget.filter((b: any) => b.categorie.type === 'revenu').reduce((s: number, b: any) => s + Number(b.montantReel), 0);
        const depenses = budget.filter((b: any) => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s: number, b: any) => s + Number(b.montantReel), 0);
        const epargne  = budget.filter((b: any) => b.categorie.type.startsWith('epargne')).reduce((s: number, b: any) => s + Number(b.montantReel), 0);
        const solde    = revenus - depenses - epargne;

        const comptes = await prisma.compteFonds.findMany({ where: { userId: params.userId, isActive: true } });
        const banques = await prisma.banque.findMany({ where: { userId: params.userId, isActive: true } });
        const epargneFonctionnement = comptes.reduce((s: number, c: any) => s + Number(c.soldeActuel), 0);
        const epargneGlobale        = banques.reduce((s: number, b: any) => s + Number(b.solde), 0);

        // Score simplifie
        const tauxEp  = revenus > 0 ? (epargne  / revenus) * 100 : 0;
        const tauxDep = revenus > 0 ? (depenses / revenus) * 100 : 0;
        let score = 10;
        if (tauxEp  >= 20) score += 4; else if (tauxEp  >= 10) score += 2;
        if (solde   >= 0)  score += 3;
        if (tauxDep <= 60) score += 3;
        score = Math.min(20, Math.max(0, score));

        // Anomalies (vs mois precedent)
        const seuilPct = params.seuilAnomaliesPct ?? 50;
        const moisPrev  = moisRapport === 1 ? 12 : moisRapport - 1;
        const anneePrev = moisRapport === 1 ? anneeRapport - 1 : anneeRapport;
        const anomalies: { categorie: string; ecart: number }[] = [];

        const anneePrevRec = await prisma.annee.findFirst({ where: { userId: params.userId, annee: anneePrev } });
        if (anneePrevRec) {
          const budgetPrev = await prisma.budgetMensuel.findMany({
            where:   { userId: params.userId, anneeId: anneePrevRec.id, mois: moisPrev },
            include: { categorie: true },
          });
          for (const ligne of budget.filter((b: any) => b.categorie.type.startsWith('depense'))) {
            const prev = budgetPrev.find((p: any) => p.categorieId === ligne.categorieId);
            if (!prev || Number(prev.montantReel) === 0) continue;
            const ecart = Math.round(((Number(ligne.montantReel) - Number(prev.montantReel)) / Number(prev.montantReel)) * 100);
            if (ecart >= seuilPct) anomalies.push({ categorie: (ligne as any).categorie.nom, ecart });
          }
          anomalies.sort((a, b) => b.ecart - a.ecart);
        }

        await envoyerRapportMensuel({
          destinataire: params.user.email,
          nom:          params.user.nom ?? undefined,
          mois:         moisRapport,
          annee:        anneeRapport,
          score, revenus, depenses, epargne, solde,
          epargneFonctionnement, epargneGlobale,
          anomalies: anomalies.slice(0, 3),
        });
        emailsEnvoyes++;
      } catch (e) {
        console.error('[cron] email error:', params.userId, e);
      }
    }));

    return NextResponse.json({ success: true, pushNotifies: subs.length, emailsEnvoyes });
  } catch (e: any) {
    console.error('[cron] fatal:', e);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}