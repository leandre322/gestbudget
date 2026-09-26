import { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import prisma from '@/lib/prisma';
import { runCron } from '@/lib/cron';

// =============================================================================
//  S7 / F8 - Capture quotidienne du patrimoine
//  GET /api/cron/patrimoine  (Vercel Cron, 02:00 UTC, authentifie par
//  CRON_SECRET via runCron)
//
//  Ecrit une ligne par compte (fonds + banque) et par date dans
//  patrimoine_snapshots. L'unicite (userId, dateSnapshot, typeSource, sourceId)
//  rend l'execution idempotente : rejouer le job le meme jour met a jour la
//  valeur au lieu de dupliquer.
//
//  Securite - cette route est sous /api/cron/*, prefixe EXEMPTE de CSRF dans
//  middleware.ts. Elle doit rester en GET et strictement lue par le cron. Un
//  eventuel bouton "Capturer maintenant" cote UI devra vivre dans une route
//  HORS /api/cron (par exemple /api/patrimoine/capture), sinon il contournerait
//  la protection CSRF.
//
//  S26 / L - l'authentification locale (comparaison de chaines non constante)
//  est remplacee par runCron, qui utilise verifyCronSecret et journalise un
//  refus en "refused" (avant : "success" sur un 401). Les details journalises
//  ne contiennent que des compteurs, jamais de nom de compte ni de solde.
//
//  Frequence recommandee : quotidienne. Volumetrie ~10 lignes/jour/utilisateur,
//  soit environ 3 650 lignes par an - negligeable, et la courbe devient lisible
//  en quelques semaines au lieu de quelques mois.
// =============================================================================

export const dynamic = 'force-dynamic';

// Benin : UTC+1 fixe, pas d'heure d'ete.
// S7 / B7 : `new Date().toISOString().split('T')[0]` renvoie la date UTC et
// produit la VEILLE entre 00h et 01h heure locale. On decale avant de tronquer.
const DECALAGE_MINUTES = 60;

function dateLocaleDuJour(): Date {
  const maintenant = new Date();
  const local = new Date(maintenant.getTime() + DECALAGE_MINUTES * 60 * 1000);
  // Minuit UTC de la date locale - coherent avec une colonne @db.Date
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

type Capture = {
  userId:     string;
  typeSource: string;
  sourceId:   string;
  sourceNom:  string;
  solde:      bigint;
};

export async function GET(req: NextRequest) {
  return runCron(req, 'patrimoine', async () => {
    const dateSnapshot = dateLocaleDuJour();

    // -- Comptes a capturer ----------------------------------------------------
    // isActive: true uniquement - un compte cloture ne doit plus alimenter la
    // courbe. Ses captures passees restent en base.
    const [comptes, banques] = await Promise.all([
      prisma.compteFonds.findMany({
        where:  { isActive: true },
        select: { id: true, userId: true, nom: true, soldeActuel: true },
      }),
      prisma.banque.findMany({
        where:  { isActive: true },
        select: { id: true, userId: true, nomBanque: true, solde: true },
      }),
    ]);

    const captures: Capture[] = [
      ...comptes.map(c => ({
        userId:     c.userId,
        typeSource: 'fonds',
        sourceId:   c.id,
        sourceNom:  c.nom,
        solde:      c.soldeActuel,
      })),
      ...banques.map(b => ({
        userId:     b.userId,
        typeSource: 'banque',
        sourceId:   b.id,
        sourceNom:  b.nomBanque,
        solde:      b.solde,
      })),
    ];

    // -- Ecriture idempotente --------------------------------------------------
    // upsert plutot que createMany({ skipDuplicates }) : si le job est rejoue
    // dans la journee, on veut le solde le PLUS RECENT, pas le premier capture.
    let ecrits  = 0;
    let erreurs = 0;
    let premiereErreur: unknown = null;

    for (const c of captures) {
      try {
        await prisma.patrimoineSnapshot.upsert({
          where: {
            userId_dateSnapshot_typeSource_sourceId: {
              userId:       c.userId,
              dateSnapshot,
              typeSource:   c.typeSource,
              sourceId:     c.sourceId,
            },
          },
          create: {
            userId:     c.userId,
            dateSnapshot,
            typeSource: c.typeSource,
            sourceId:   c.sourceId,
            sourceNom:  c.sourceNom,
            solde:      c.solde,
          },
          update: {
            sourceNom: c.sourceNom,   // suit un renommage de compte
            solde:     c.solde,
          },
        });
        ecrits++;
      } catch (e) {
        // Une capture en echec ne doit pas faire tomber tout le job
        erreurs++;
        if (premiereErreur === null) premiereErreur = e;
        console.error('[cron/patrimoine] capture echouee:', c.typeSource, c.sourceId, e);
      }
    }

    // Une seule exception envoyee a Sentry (avec sa pile), quel que soit le
    // nombre d'echecs : quota maitrise, cause racine visible.
    if (premiereErreur !== null) {
      Sentry.captureException(premiereErreur, { tags: { zone: 'cron-patrimoine', etape: 'upsert' } });
    }

    const statut = erreurs === 0 ? 'success'
                 : ecrits === 0  ? 'error'
                 : 'partial';
    const date = dateSnapshot.toISOString().slice(0, 10);

    return {
      statut,
      details: {
        date,
        captures: ecrits,
        total:    captures.length,
        fonds:    comptes.length,
        banques:  banques.length,
        erreurs,
      },
      body: {
        ok:       statut === 'success',
        date,
        captures: ecrits,
        erreurs,
        fonds:    comptes.length,
        banques:  banques.length,
      },
    };
  });
}
