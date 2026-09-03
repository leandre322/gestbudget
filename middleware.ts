import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';
import {
  matchPath,
  matchAnyPath,
  verifyCsrf,
  verifyCronSecret,
  withSecurityHeaders,
  secureJson,
  getClientIp,
  CRON_PREFIXES,
  CSRF_EXEMPT_PREFIXES,
} from '@/lib/csrf';

// ── P1 : client Neon hoiste au niveau module ─────────────────────────────────
// Avant : neon(...) etait instancie A CHAQUE appel de checkRL.
// Un client par isolate, reutilise sur toute sa duree de vie.
const sqlClient = process.env.DATABASE_URL_UNPOOLED
  ? neon(process.env.DATABASE_URL_UNPOOLED)
  : null;

const rlFallback = new Map<string, { count: number; resetAt: number }>();

function checkRLMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlFallback.get(key);
  if (!e || now > e.resetAt) {
    rlFallback.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}

async function checkRL(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!sqlClient) return checkRLMemory(key, limit, windowMs);
  try {
    const resetAt = new Date(Date.now() + windowMs).toISOString();
    const rows = await sqlClient`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (${key}, 1, ${resetAt}::timestamptz)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.reset_at < NOW() THEN 1
          ELSE rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN rate_limits.reset_at < NOW() THEN EXCLUDED.reset_at
          ELSE rate_limits.reset_at
        END
      RETURNING count
    `;
    return (rows[0]?.count ?? 1) <= limit;
  } catch {
    return checkRLMemory(key, limit, windowMs);
  }
}

// ── Regles IP-based (routes publiques sensibles) ─────────────────────────────
const RATE_RULES = [
  { path: '/api/auth',            limit: 10, window:  60_000 },
  { path: '/api/register',        limit:  3, window: 300_000 },
  { path: '/api/forgot-password', limit:  3, window: 300_000 },
  { path: '/api/reset-password',  limit:  5, window:  60_000 },
  { path: '/api/push/subscribe',  limit: 20, window:  60_000 },
];

// ── Regles userId-based (routes lourdes authentifiees) ───────────────────────
const AUTH_RATE_RULES = [
  { path: '/api/analytiques',  limit: 60, window: 60_000 },
  { path: '/api/export/pdf',   limit: 10, window: 60_000 },
  { path: '/api/export/excel', limit: 10, window: 60_000 },
  { path: '/api/quick-add',    limit: 30, window: 60_000 },
];

const PROTECTED_PAGES = [
  '/dashboard', '/suivi', '/recapitulatif',
  '/budget', '/decaissements', '/parametres', '/ajout-retrait-fonds',
  '/projets',
  '/analytiques',
  '/recurrentes',
];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const ip = getClientIp(req); // N2

  // ── 1. N5 : routes cron authentifiees par CRON_SECRET ──────────────────────
  // Ces routes restent exemptees de CSRF (aucun Origin depuis Vercel Cron),
  // mais l'exemption devient un ECHANGE : pas d'Origin, mais un secret valide.
  // Fail-closed : secret absent en production => 401.
  if (matchAnyPath(pathname, CRON_PREFIXES)) {
    if (!verifyCronSecret(req)) {
      return secureJson({ error: 'Non autorise' }, 401);
    }
    return withSecurityHeaders(NextResponse.next());
  }

  // ── 2. Rate limiting IP (routes publiques sensibles) ───────────────────────
  for (const rule of RATE_RULES) {
    if (matchPath(pathname, rule.path)) { // N1
      const allowed = await checkRL(`${ip}:${rule.path}`, rule.limit, rule.window);
      if (!allowed) {
        const retryAfter = Math.ceil(rule.window / 1000);
        return secureJson(
          { error: `Trop de requetes. Reessayez dans ${retryAfter} secondes.` },
          429,
          { 'Retry-After': String(retryAfter) }
        );
      }
    }
  }

  // ── 3. CSRF sur toutes les mutations API (S1 + S2) ─────────────────────────
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase());
  const isApiRoute = matchPath(pathname, '/api');
  const isExempt   = matchAnyPath(pathname, CSRF_EXEMPT_PREFIXES); // NextAuth uniquement

  if (isMutation && isApiRoute && !isExempt) {
    const verdict = verifyCsrf(req);
    if (!verdict.ok) {
      return secureJson({ error: 'Requete non autorisee (CSRF)' }, 403);
    }
  }

  // ── 4. Auth (pages protegees) + rate limiting userId ───────────────────────
  const isProtected = matchAnyPath(pathname, PROTECTED_PAGES);
  const isAuthRL    = AUTH_RATE_RULES.some(r => matchPath(pathname, r.path));

  if (isProtected || isAuthRL) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (isProtected && !token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('callbackUrl', pathname);
      return withSecurityHeaders(NextResponse.redirect(url)); // N3
    }

    if (isAuthRL && token?.sub) {
      for (const rule of AUTH_RATE_RULES) {
        if (matchPath(pathname, rule.path)) {
          const allowed = await checkRL(`uid:${token.sub}:${rule.path}`, rule.limit, rule.window);
          if (!allowed) {
            const retryAfter = Math.ceil(rule.window / 1000);
            return secureJson(
              { error: `Trop de requetes. Reessayez dans ${retryAfter} secondes.` },
              429,
              { 'Retry-After': String(retryAfter) }
            );
          }
        }
      }
    }
  }

  // ── 5. Headers securite (N3 + N4) ──────────────────────────────────────────
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/suivi/:path*',
    '/recapitulatif/:path*',
    '/budget/:path*',
    '/decaissements/:path*',
    '/parametres/:path*',
    '/ajout-retrait-fonds/:path*',
    '/projets/:path*',
    '/analytiques/:path*',
    '/recurrentes/:path*',
    '/api/:path*',
  ],
};