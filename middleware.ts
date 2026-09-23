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

// S26 (B2b-ii) : lecture directe de users.tokenVersion, hors Prisma (Edge).
// Le retour null couvre a la fois "pas de client SQL" et "l'utilisateur a
// disparu" — les deux doivent produire un fail-closed identique cote appelant.
async function getTokenVersion(userId: string): Promise<number | null> {
  if (!sqlClient) return null;
  try {
    const rows = await sqlClient`SELECT "tokenVersion" FROM users WHERE id = ${userId} LIMIT 1`;
    return typeof rows[0]?.tokenVersion === 'number' ? rows[0].tokenVersion : null;
  } catch {
    return null;
  }
}

// ── Regles IP-based (routes publiques sensibles) ─────────────────────────────
const RATE_RULES = [
  { path: '/api/auth/signin',   limit: 10, window: 60_000 },
  // P116 (S19) : matchPath est un match de prefixe, donc '/api/auth' couvrait
  // AUSSI session, csrf, providers et signout — que le client NextAuth appelle
  // en permanence. Dix requetes suffisaient a verrouiller un utilisateur
  // legitime, et chaque tentative de reconnexion rechargeait le compteur au
  // lieu de le vider. Seuls signin et callback (verification du mot de passe)
  // restent limites : la protection anti credential stuffing est intacte.
  { path: '/api/auth/callback',            limit: 10, window:  60_000 },
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
  // S26 : ces trois routes font un bcrypt.compare du mot de passe. Il faut deja
  // une session valide pour les atteindre, mais une session volee pouvait y
  // tester des mots de passe sans limite. 5 essais / 15 min et par route.
  // /api/2fa/devices (lecture) et /api/2fa/activate (compteur propre dans la
  // route) sont volontairement hors de ces regles.
  { path: '/api/2fa/enroll',       limit: 5, window: 900_000 },
  { path: '/api/2fa/trust-device', limit: 5, window: 900_000 },
  { path: '/api/2fa/disable',      limit: 5, window: 900_000 },
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

    // S26 (B2b-ii) : un reset de mot de passe incremente users.tokenVersion.
    // Le JWT emis avant ce reset porte l'ancienne valeur -> comparaison en
    // base a chaque page protegee. Fail-closed deliberement : si la lecture
    // Neon echoue (panne, latence), on renvoie vers /login plutot que de
    // laisser passer un token qu'on n'a pas pu revalider. Cout : un aller-
    // retour Neon de plus par navigation sur une page protegee.
    if (isProtected && token?.sub) {
      const versionActuelle = await getTokenVersion(token.sub);
      if (versionActuelle === null || versionActuelle !== token.tokenVersion) {
        const url = req.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('callbackUrl', pathname);
        return withSecurityHeaders(NextResponse.redirect(url));
      }
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

// S26 : l'ancienne liste explicite oubliait /login, /register,
// /forgot-password, /reset-password, / et /offline. Le middleware ne
// s'executait pas sur ces pages : aucun en-tete de securite (ni CSP, ni
// Permissions-Policy, ni Referrer-Policy) sur la page ou l'on saisit son mot
// de passe. Verifie en production le 21/09/2026.
//
// Nouveau principe : tout passe par le middleware SAUF les fichiers statiques.
// Une page ajoutee demain sera couverte d'office au lieu d'etre oubliee.
// Exclusions :
//   - _next/static, _next/image : assets du build, aucun en-tete utile ;
//   - *.js : surtout sw.js, workbox-*.js, worker-*.js. Une CSP posee sur le
//     script d'un Service Worker gouverne les requetes du worker lui-meme :
//     risque de casser le cache PWA et les notifications push ;
//   - images, polices, manifest, sourcemaps.
// Cout : une execution Edge de plus sur les pages publiques, sans acces base
// (aucune regle de debit ne vise une page) : negligeable.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:js|mjs|json|map|png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|txt|xml|webmanifest)$).*)',
  ],
};