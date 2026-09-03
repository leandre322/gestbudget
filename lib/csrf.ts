import { NextRequest, NextResponse } from 'next/server';

/**
 * S8 - Module unique de securite edge-safe.
 * Consomme par middleware.ts ET lib/api-helpers.ts : une seule verite,
 * plus de divergence possible entre les deux implementations.
 *
 * Aucune dependance Node (pas de crypto, pas de Buffer) : compatible Edge Runtime.
 * Aucun accent dans les chaines : discipline encodage UTF-8 du projet.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// ── N1 : match de chemin strict ──────────────────────────────────────────────
// pathname.startsWith('/budget') matchait '/budget-admin'.
// pathname.startsWith('/api/auth') matchait '/api/auth-tokens' (= exemption CSRF
// accordee par accident a une route future mal nommee).
export function matchPath(pathname: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function matchAnyPath(pathname: string, prefixes: string[]): boolean {
  for (let i = 0; i < prefixes.length; i++) {
    if (matchPath(pathname, prefixes[i])) return true;
  }
  return false;
}

// ── Comparaison a temps constant (fuite de longueur acceptee) ────────────────
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── S2b : normalisation d'origine qui ne throw JAMAIS ────────────────────────
// new URL('gestbudget.lawdigitals.com') levait une exception dans le middleware
// => 500 sur TOUTE l'application, pages incluses.
function normalizeOrigin(value: string): string | null {
  const v = (value || '').trim();
  if (!v || v === 'null') return null;
  try {
    const withScheme = /^https?:\/\//i.test(v) ? v : 'https://' + v;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

// ── S2 : resolution fail-closed des origines autorisees ──────────────────────
// Chaine : ALLOWED_ORIGINS (CSV) > NEXT_PUBLIC_APP_URL > URL prod Vercel.
// VERCEL_URL (previews) volontairement EXCLU : deploiement production uniquement.
export function resolveAllowedOrigins(): string[] {
  const out: string[] = [];

  const push = (raw?: string | null) => {
    if (!raw) return;
    const parts = raw.split(',');
    for (let i = 0; i < parts.length; i++) {
      const o = normalizeOrigin(parts[i]);
      if (o && out.indexOf(o) === -1) out.push(o);
    }
  };

  push(process.env.ALLOWED_ORIGINS);
  push(process.env.NEXT_PUBLIC_APP_URL);
  push(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  if (!IS_PROD) {
    push('http://localhost:3000');
    push('http://127.0.0.1:3000');
  }

  return out;
}

export type CsrfVerdict = { ok: true; reason: null } | { ok: false; reason: string };

// ── S1 : verification CSRF stricte ───────────────────────────────────────────
// Avant : origin.startsWith(allowed) || referer.startsWith(allowed)
//   => "https://gestbudget.lawdigitals.com.evil.com".startsWith(...) === true
// Apres : egalite stricte d'origines normalisees, Origin PRIORITAIRE.
//   Le repli en OU logique sur Referer affaiblissait la verification :
//   un Origin present et invalide doit rejeter, sans seconde chance.
export function verifyCsrf(req: NextRequest): CsrfVerdict {
  const method = (req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.indexOf(method) !== -1) return { ok: true, reason: null };

  const allowed = resolveAllowedOrigins();

  // S2 : plus de desactivation silencieuse.
  if (allowed.length === 0) {
    if (IS_PROD) return { ok: false, reason: 'aucune origine autorisee configuree' };
    return { ok: true, reason: null };
  }

  const originHeader = req.headers.get('origin');
  if (originHeader) {
    const o = normalizeOrigin(originHeader);
    if (!o || allowed.indexOf(o) === -1) return { ok: false, reason: 'origin invalide' };
    return { ok: true, reason: null };
  }

  const refererHeader = req.headers.get('referer');
  if (refererHeader) {
    const r = normalizeOrigin(refererHeader);
    if (!r || allowed.indexOf(r) === -1) return { ok: false, reason: 'referer invalide' };
    return { ok: true, reason: null };
  }

  return { ok: false, reason: 'origin et referer absents' };
}

// ── N5 : authentification des routes cron ────────────────────────────────────
// Vercel Cron envoie automatiquement "Authorization: Bearer $CRON_SECRET"
// des que la variable existe dans le projet.
// Fail-closed en production : secret absent => 401, jamais 200.
export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) return !IS_PROD; // dev local sans secret : tolere. Prod : refus.

  const header = req.headers.get('authorization') ?? '';
  return safeEqual(header, 'Bearer ' + secret);
}

export const CRON_PREFIXES = ['/api/cron', '/api/push/cron'];

// NextAuth v4 possede son PROPRE jeton CSRF (double-submit cookie) sur ses
// endpoints. On conserve donc l'exemption : la doubler casserait les callbacks.
export const CSRF_EXEMPT_PREFIXES = ['/api/auth'];

// ── N3 + N4 : headers de securite appliques a TOUTES les reponses ────────────
// Avant, seul NextResponse.next() les recevait : les 429, 403 et la redirection
// login partaient sans nosniff, sans HSTS, sans X-Frame-Options.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

export function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options',        'SAMEORIGIN');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy',        'strict-origin-when-cross-origin');

  // NOTE : microphone volontairement NON restreint (Web Speech API, saisie vocale D1).
  res.headers.set(
    'Permissions-Policy',
    'camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), interest-cohort=()'
  );

  // X-XSS-Protection retire : deprecie, ignore par tous les navigateurs actuels,
  // et son filtre heuristique a lui-meme introduit des vulnerabilites.

  if (IS_PROD) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // CSP en Report-Only par defaut : on observe les violations sans rien casser
  // dans la PWA. Passer CSP_ENFORCE=1 dans Vercel pour bloquer, sans toucher au code.
  const cspHeader = process.env.CSP_ENFORCE === '1'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';
  res.headers.set(cspHeader, CSP_DIRECTIVES);

  return res;
}

// ── N2 : IP client, source plateforme prioritaire ────────────────────────────
export function getClientIp(req: NextRequest): string {
  const vercelIp = req.headers.get('x-vercel-forwarded-for');
  if (vercelIp) return vercelIp.split(',')[0].trim();

  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  return '0.0.0.0';
}

// ── Reponse JSON qui embarque toujours les headers de securite ───────────────
export function secureJson(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>
): NextResponse {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (extraHeaders) {
    const keys = Object.keys(extraHeaders);
    for (let i = 0; i < keys.length; i++) headers[keys[i]] = extraHeaders[keys[i]];
  }
  return withSecurityHeaders(new NextResponse(JSON.stringify(body), { status, headers }));
}