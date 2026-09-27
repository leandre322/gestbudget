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
//
//  S26 / M - Surveillance en cascade (offre Sentry gratuite : 1 moniteur).
//  cron_logs ne peut pas signaler une ABSENCE : un cron qui ne se declenche
//  plus n'ecrit rien. D'ou deux niveaux :
//   1. un moniteur Sentry (captureCheckIn) sur maintenance seule, via
//      l'option `moniteur` de runCron ;
//   2. maintenance verifie a son tour, dans cron_logs, le dernier passage
//      success|partial des autres jobs (CRON_VEILLE ci-dessous).
//  Regles du moniteur :
//   - check-in APRES l'authentification : un appel non autorise ne peut pas
//     envoyer un "ok" qui masquerait l'absence du vrai passage ;
//   - production uniquement (VERCEL_ENV) : ni Preview ni poste local ;
//   - marge de 75 min : Vercel declenche a un instant quelconque de l'heure
//     (passage observe a 03:25:58 pour 0 3 * * *) ;
//   - statut error -> check-in error ; success et partial -> ok (le detail
//     d'un partial part deja en avertissement Sentry) ;
//   - flush borne a 2 s : en serverless, un check-in encore en file peut etre
//     perdu a la fin de la fonction.
//  Les constantes sont ici et non dans la route : Next.js refuse tout export
//  non standard d'un route.ts, et la CI (lot P) pourra les comparer a
//  vercel.json.
// =============================================================================

export type CronStatut = 'success' | 'partial' | 'refused' | 'error';

export type CronDetails = Record<string, unknown>;

export type CronResultat = {
  statut:  Exclude<CronStatut, 'refused'>;
  details: CronDetails;
  body:    Record<string, unknown>;
};

export type CronMoniteur = {
  slug:    string;
  crontab: string;   // doit rester identique au schedule de vercel.json
};

export type CronOptions = {
  moniteur?: CronMoniteur;
};

// Moniteur Sentry unique (offre gratuite) : maintenance, 0 3 * * * dans vercel.json
export const MONITEUR_MAINTENANCE: CronMoniteur = {
  slug:    'gestbudget-maintenance',
  crontab: '0 3 * * *',
};

// Veille assuree par maintenance (03:00 UTC, passage reel vers 03:25).
// Seuils calcules pour qu'un passage normal ne declenche jamais d'alerte et
// qu'un passage manque soit detecte au plus tot :
//  - patrimoine (0 2 * * *)             : age normal ~1,4 h   -> 26 h, detection le jour meme
//  - bilan-hebdo (0 8 * * 1)            : age normal <= 6,8 j -> 180 h, detection le mardi
//  - recurrentes-mensuelles (0 6 1 * *) : age normal <= 30,9 j -> 744 h, detection le 2 ou le 3
export const CRON_VEILLE: ReadonlyArray<{ job: string; seuilHeures: number }> = [
  { job: 'patrimoine',             seuilHeures: 26 },
  { job: 'bilan-hebdo',            seuilHeures: 180 },
  { job: 'recurrentes-mensuelles', seuilHeures: 744 },
];

const MONITEUR_MARGE_MIN   = 75;
const MONITEUR_DUREE_MAX   = 5;
const MONITEUR_FLUSH_MS    = 2000;

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
  options: CronOptions = {},
): Promise<NextResponse> {
  const debut = Date.now();
  let statut: CronStatut  = 'error';
  let details: CronDetails = { motif: 'interruption' };
  let journaliser          = true;
  let checkInId: string | null = null;

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

    // Check-in "en cours" : apres l'authentification, en production uniquement.
    // Un echec du SDK ne doit jamais empecher le job de tourner.
    const moniteur = options.moniteur;
    if (moniteur && process.env.VERCEL_ENV === 'production') {
      try {
        checkInId = Sentry.captureCheckIn(
          { monitorSlug: moniteur.slug, status: 'in_progress' },
          {
            schedule:              { type: 'crontab', value: moniteur.crontab },
            checkinMargin:         MONITEUR_MARGE_MIN,
            maxRuntime:            MONITEUR_DUREE_MAX,
            timezone:              'UTC',
            failureIssueThreshold: 1,
            recoveryThreshold:     1,
          },
        );
      } catch (e) {
        console.error(`[cron/${jobName}] check-in Sentry:`, e);
      }
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

    // Check-in final, puis flush borne (voir en-tete).
    if (checkInId && options.moniteur) {
      try {
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: options.moniteur.slug,
          status:      statut === 'error' ? 'error' : 'ok',
          duration:    (Date.now() - debut) / 1000,
        });
        await Sentry.flush(MONITEUR_FLUSH_MS);
      } catch (e) {
        console.error(`[cron/${jobName}] check-in Sentry:`, e);
      }
    }
  }
}
