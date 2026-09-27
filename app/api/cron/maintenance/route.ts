import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import * as Sentry from '@sentry/nextjs';
import prisma from '@/lib/prisma';
import { runCron, CRON_VEILLE, MONITEUR_MAINTENANCE, type CronDetails } from '@/lib/cron';

// =============================================================================
//  S26 / G + Q + T - Maintenance quotidienne
//  GET /api/cron/maintenance  (Vercel Cron, 03:00 UTC, authentifie par
//  CRON_SECRET via runCron, surveille par le moniteur Sentry unique)
//
//  Etape 1 - rate_limits (G + Q)
//  La purge utilise EXACTEMENT la meme connexion que les ecritures du
//  middleware (EDGE_DATABASE_URL) : elle nettoie toujours la table que le
//  rate limiting alimente reellement. current_database() est journalise a
//  chaque passage : preuve continue de la base effectivement purgee.
//
//  Marge d'un jour : une ligne expiree ne sert plus au comptage (l'upsert du
//  middleware la remet a 1), mais la garder 24 h permet d'examiner apres coup
//  une rafale de 429. La fenetre la plus longue du middleware est de 15 min
//  (2FA) : la purge ne peut jamais effacer un compteur actif.
//
//  Q - piege PostgreSQL : dans une CTE qui modifie des donnees, la requete
//  principale lit le MEME instantane que le DELETE et ne voit pas son effet.
//  Un simple COUNT(*) sur rate_limits compterait aussi les lignes purgees.
//  Les restantes sont donc comptees par le critere complementaire, dans la
//  meme instruction. NOW() est fige pour toute la transaction : les deux
//  criteres utilisent le meme instant, sans trou ni recouvrement.
//
//  Etape 2 - cron_logs (T)
//  Retention de 90 jours sur startedAt. Volume : environ 65 lignes par mois
//  pour les 4 crons, donc un parcours complet est instantane (pas d'index
//  dedie). La purge precede l'ecriture de la ligne du jour par runCron.
//
//  Etape 3 - veille des autres crons (M)
//  Pour chaque job de CRON_VEILLE (lib/cron.ts) : age du dernier passage
//  success|partial. Les statuts refused, error et running (ligne laissee par
//  une fonction interrompue) ne comptent pas. Une lecture par job, en
//  parallele, servie par l'index (jobName, startedAt).
//  Job en retard ou jamais execute : une alerte Sentry DISTINCTE par job et
//  par etat (empreinte dediee), donc un e-mail par probleme, en production
//  uniquement. Aucune ligne fictive n'est jamais ecrite pour combler un trou.
//  Un retard ne change PAS le statut de maintenance, qui ne reflete que son
//  propre travail : il figure dans details.veille.enRetard.
//
//  Les trois etapes sont independantes : l'echec de l'une n'empeche pas
//  les autres. Statut : success (0 echec), error (3), partial sinon.
// =============================================================================

export const dynamic = 'force-dynamic';

const RETENTION_CRON_LOGS_JOURS = 90;
const JOUR_MS                   = 86_400_000;
const HEURE_MS                  = 3_600_000;
const NB_ETAPES                 = 3;

type LigneRateLimits = {
  base:      string | null;
  purges:    number | null;
  restants:  number | null;
  max_reset: string | Date | null;
};

function versIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function GET(req: NextRequest) {
  return runCron(req, 'maintenance', async () => {
    const details: CronDetails = {};
    let echecs = 0;

    // -- Etape 1 : rate_limits --------------------------------------------------
    const url = process.env.EDGE_DATABASE_URL;
    if (!url) {
      echecs++;
      details.rateLimits = { erreur: 'edge_database_url_absente' };
    } else {
      try {
        const sql  = neon(url);
        const rows = (await sql`
          WITH purge AS (
            DELETE FROM rate_limits
            WHERE reset_at < NOW() - INTERVAL '1 day'
            RETURNING 1
          )
          SELECT
            current_database()                 AS base,
            (SELECT COUNT(*)::int FROM purge)  AS purges,
            COUNT(*)::int                      AS restants,
            MAX(reset_at)                      AS max_reset
          FROM rate_limits
          WHERE reset_at IS NULL OR reset_at >= NOW() - INTERVAL '1 day'
        `) as LigneRateLimits[];
        const r = rows[0];
        details.base       = r?.base ?? null;
        details.rateLimits = {
          purges:     Number(r?.purges ?? 0),
          restants:   Number(r?.restants ?? 0),
          maxResetAt: versIso(r?.max_reset),
        };
      } catch (e) {
        echecs++;
        details.rateLimits = { erreur: 'exception' };
        console.error('[cron/maintenance] rate_limits:', e);
        Sentry.captureException(e, { tags: { zone: 'cron-maintenance', etape: 'rate_limits' } });
      }
    }

    // -- Etape 2 : cron_logs ----------------------------------------------------
    try {
      const limite = new Date(Date.now() - RETENTION_CRON_LOGS_JOURS * JOUR_MS);
      const res    = await prisma.cronLog.deleteMany({ where: { startedAt: { lt: limite } } });
      details.cronLogs = { purges: res.count, retentionJours: RETENTION_CRON_LOGS_JOURS };
    } catch (e) {
      echecs++;
      details.cronLogs = { erreur: 'exception' };
      console.error('[cron/maintenance] cron_logs:', e);
      Sentry.captureException(e, { tags: { zone: 'cron-maintenance', etape: 'cron_logs' } });
    }

    // -- Etape 3 : veille des autres crons ----------------------------------
    try {
      const maintenant = Date.now();
      const derniers = await Promise.all(
        CRON_VEILLE.map(v =>
          prisma.cronLog.findFirst({
            where:   { jobName: v.job, status: { in: ['success', 'partial'] } },
            orderBy: { startedAt: 'desc' },
            select:  { startedAt: true },
          }),
        ),
      );

      const agesHeures: Record<string, number | null> = {};
      const enRetard: string[] = [];

      CRON_VEILLE.forEach((v, i) => {
        const dernier = derniers[i];
        const age = dernier
          ? Math.round(((maintenant - dernier.startedAt.getTime()) / HEURE_MS) * 10) / 10
          : null;
        agesHeures[v.job] = age;

        const etat = age === null ? 'jamais' : age > v.seuilHeures ? 'retard' : null;
        if (etat === null) return;
        enRetard.push(v.job);

        if (process.env.VERCEL_ENV === 'production') {
          Sentry.captureMessage(
            etat === 'jamais'
              ? `[cron/veille] ${v.job} : aucun passage success|partial dans cron_logs`
              : `[cron/veille] ${v.job} : dernier passage il y a ${age} h (seuil ${v.seuilHeures} h)`,
            {
              level:       etat === 'jamais' ? 'warning' : 'error',
              tags:        { zone: 'cron-veille', job: v.job, etat },
              fingerprint: ['cron-veille', v.job, etat],
            },
          );
        }
      });

      details.veille = { agesHeures, enRetard };
    } catch (e) {
      echecs++;
      details.veille = { erreur: 'exception' };
      console.error('[cron/maintenance] veille:', e);
      Sentry.captureException(e, { tags: { zone: 'cron-maintenance', etape: 'veille' } });
    }

    const statut = echecs === 0 ? 'success' : echecs === NB_ETAPES ? 'error' : 'partial';
    return { statut, details, body: { ok: statut === 'success', statut, details } };
  }, { moniteur: MONITEUR_MAINTENANCE });
}
