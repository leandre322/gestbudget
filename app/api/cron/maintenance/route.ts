import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import * as Sentry from '@sentry/nextjs';
import prisma from '@/lib/prisma';
import { verifyCronSecret } from '@/lib/csrf';

// =============================================================================
//  S26 / G - Maintenance quotidienne : purge de rate_limits
//  GET /api/cron/maintenance  (Vercel Cron, authentifie par CRON_SECRET)
//
//  Remplace la purge "P3" de /api/cron/patrimoine, qui ne s'executait jamais :
//  placee APRES un try/catch dont toutes les branches font return, c'etait du
//  code mort. Elle passait en outre par Prisma (DATABASE_URL), alors que le
//  middleware ecrivait via une autre variable qui ciblait neondb en production.
//
//  Regle : la purge utilise EXACTEMENT la meme connexion que les ecritures du
//  middleware (EDGE_DATABASE_URL). Elle nettoie donc toujours la table que le
//  rate limiting alimente reellement, quelle que soit la base visee.
//
//  Marge d'un jour : une ligne expiree ne sert plus au comptage (l'upsert du
//  middleware la remet a 1), mais la garder 24 h permet d'examiner apres coup
//  une rafale de 429 (tentatives de mot de passe, par exemple).
//
//  Securite : sous /api/cron/*, deja verifie par le middleware. La meme
//  verification est refaite ici en defense en profondeur, avec la fonction
//  partagee de lib/csrf.ts plutot qu'une comparaison de chaines locale.
//  Le typage explicite `boolean` garantit a la compilation que le retour de
//  verifyCronSecret est bien un booleen (un objet serait toujours "vrai").
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const debut = Date.now();
  let statut  = 'success';
  let details = '';

  try {
    const autorise: boolean = verifyCronSecret(req);
    if (!autorise) {
      statut  = 'refused';
      details = 'Secret cron invalide';
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
    }

    const url = process.env.EDGE_DATABASE_URL;
    if (!url) {
      statut  = 'error';
      details = 'EDGE_DATABASE_URL absente : purge impossible';
      Sentry.captureMessage('[cron/maintenance] EDGE_DATABASE_URL absente', 'warning');
      return NextResponse.json({ error: 'Configuration incomplete' }, { status: 500 });
    }

    const sql  = neon(url);
    const rows = await sql`
      WITH purge AS (
        DELETE FROM rate_limits
        WHERE reset_at < NOW() - INTERVAL '1 day'
        RETURNING 1
      )
      SELECT COUNT(*)::int AS n FROM purge
    `;
    const purges = Number(rows[0]?.n ?? 0);
    details = `rate_limits : ${purges} ligne(s) expiree(s) purgee(s)`;

    return NextResponse.json({ ok: true, rateLimitsPurges: purges });

  } catch (e) {
    statut  = 'error';
    details = 'Erreur inattendue';
    console.error('[cron/maintenance] GET:', e);
    Sentry.captureException(e, { tags: { zone: 'cron-maintenance' } });
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });

  } finally {
    // Journalisation best-effort - ne doit jamais masquer l'erreur d'origine
    try {
      await prisma.cronLog.create({
        data: {
          jobName:    'maintenance',
          status:     statut,
          durationMs: Date.now() - debut,
          details:    details || null,
        },
      });
    } catch (e) {
      console.error('[cron/maintenance] CronLog:', e);
    }
  }
}
