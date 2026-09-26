import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import prisma from '@/lib/prisma';
import { verifyCronSecret } from '@/lib/csrf';

// =============================================================================
//  S26 / Q+T+L - Enveloppe commune des routes cron : runCron()
//
//  Pourquoi : chaque route cron recopiait son authentification, son statut et
//  sa journalisation. C'est cette duplication qui a produit le bug L : la route
//  patrimoine comparait le secret localement (comparaison non constante) et
//  journalisait "success" sur un 401, car son statut valait "success" des le
//  depart et n'etait jamais modifie avant le return.
//
//  runCron centralise, pour toutes les routes qui l'utilisent :
//   - l'authentification, via verifyCronSecret (comparaison en temps constant) ;
//   - le statut : success | partial | refused | error. Le handler DOIT renvoyer
//     un statut explicite (impose par le type CronResultat) et ne peut pas
//     renvoyer "refused", reserve a l'enveloppe ;
//   - les details, toujours en JSON strict et versionne (champ v) ;
//   - Sentry : refus, statut partial ou error, exception non rattrapee ;
//   - la ligne cron_logs, ecrite dans finally en best-effort : un echec
//     d'ecriture du journal ne masque jamais l'erreur d'origine.
//
//  Refus : le middleware verifie deja /api/cron/*. Un refus a ce niveau
//  signifie donc que ce premier controle a ete contourne ou mal configure :
//  signal rare et significatif, envoye a Sentry. Pour qu'un appelant non
//  authentifie ne puisse ni remplir cron_logs ni epuiser le quota Sentry, les
//  refus sont limites a une ligne et un signal par instance toutes les
//  10 minutes ; les refus intermediaires sont comptes (refusNonJournalises).
//  Aucune IP ni aucun en-tete recu n'est journalise.
//
//  Details : jamais de donnee personnelle ni financiere (noms de comptes,
//  soldes) - uniquement des compteurs et des codes. Taille bornee : au-dela de
//  DETAILS_TAILLE_MAX, les details sont remplaces par un marqueur plutot que
//  tronques, pour que la colonne contienne toujours du JSON valide.
// =============================================================================

export type CronStatut = 'success' | 'partial' | 'refused' | 'error';

export type CronDetails = Record<string, unknown>;

export type CronResultat = {
  statut:  Exclude<CronStatut, 'refused'>;
  details: CronDetails;
  body:    Record<string, unknown>;
};

const DETAILS_VERSION     = 1;
const DETAILS_TAILLE_MAX  = 4000;
const REFUS_INTERVALLE_MS = 600_000;

// Etat par instance serverless (best-effort, remis a zero a chaque demarrage a froid)
let dernierRefusJournalise = 0;
let refusNonJournalises    = 0;

export function serialiserDetails(details: CronDetails): string {
  let json: string;
  try {
    // v est place en tete puis reimpose : un handler ne peut pas l'ecraser.
    // BigInt n'est pas serialisable en JSON : conversion par Number (regle 22).
    json = JSON.stringify(
      Object.assign({ v: DETAILS_VERSION }, details, { v: DETAILS_VERSION }),
      (_cle: string, valeur: unknown) => (typeof valeur === 'bigint' ? Number(valeur) : valeur),
    );
  } catch {
    return JSON.stringify({ v: DETAILS_VERSION, serialisation: 'echec' });
  }
  if (json.length > DETAILS_TAILLE_MAX) {
    return JSON.stringify({ v: DETAILS_VERSION, tronque: true, taille: json.length });
  }
  return json;
}

export async function runCron(
  req: NextRequest,
  jobName: string,
  handler: () => Promise<CronResultat>,
): Promise<NextResponse> {
  const debut = Date.now();
  let statut: CronStatut  = 'error';
  let details: CronDetails = { motif: 'interruption' };
  let journaliser          = true;

  try {
    // Typage explicite : garantit a la compilation un booleen (un objet serait toujours vrai)
    const autorise: boolean = verifyCronSecret(req);
    if (!autorise) {
      statut = 'refused';
      const motif = process.env.CRON_SECRET ? 'secret_invalide' : 'secret_absent';
      const maintenant = Date.now();
      if (maintenant - dernierRefusJournalise >= REFUS_INTERVALLE_MS) {
        details = { motif, refusNonJournalises };
        dernierRefusJournalise = maintenant;
        refusNonJournalises    = 0;
        Sentry.captureMessage(`[cron/${jobName}] appel refuse : ${motif}`, {
          level: motif === 'secret_absent' ? 'error' : 'warning',
          tags:  { zone: `cron-${jobName}` },
        });
      } else {
        journaliser = false;
        refusNonJournalises++;
      }
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
    }

    const resultat = await handler();
    statut  = resultat.statut;
    details = resultat.details;

    if (resultat.statut !== 'success') {
      Sentry.captureMessage(`[cron/${jobName}] statut ${resultat.statut}`, {
        level: resultat.statut === 'error' ? 'error' : 'warning',
        tags:  { zone: `cron-${jobName}` },
      });
    }

    return NextResponse.json(resultat.body, { status: resultat.statut === 'error' ? 500 : 200 });

  } catch (e) {
    statut  = 'error';
    details = { motif: 'exception' };
    console.error(`[cron/${jobName}] exception:`, e);
    Sentry.captureException(e, { tags: { zone: `cron-${jobName}` } });
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });

  } finally {
    if (journaliser) {
      try {
        await prisma.cronLog.create({
          data: {
            jobName,
            status:     statut,
            durationMs: Date.now() - debut,
            details:    serialiserDetails(details),
          },
        });
      } catch (e) {
        console.error(`[cron/${jobName}] CronLog:`, e);
      }
    }
  }
}
