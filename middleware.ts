import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';

// ── Rate limiter persistant Neon + fallback in-memory ────────────────────────
const rlFallback = new Map<string, { count: number; resetAt: number }>();

async function checkRL(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!process.env.DATABASE_URL_UNPOOLED) {
    const now = Date.now();
    const e = rlFallback.get(key);
    if (!e || now > e.resetAt) { rlFallback.set(key, { count: 1, resetAt: now + windowMs }); return true; }
    if (e.count >= limit) return false;
    e.count++;
    return true;
  }
  try {
    const sql = neon(process.env.DATABASE_URL_UNPOOLED);
    const resetAt = new Date(Date.now() + windowMs).toISOString();
    const rows = await sql`
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
    const now = Date.now();
    const e = rlFallback.get(key);
    if (!e || now > e.resetAt) { rlFallback.set(key, { count: 1, resetAt: now + windowMs }); return true; }
    if (e.count >= limit) return false;
    e.count++;
    return true;
  }
}

const RATE_RULES = [
  { path: '/api/auth',            limit: 10, window:  60_000 },
  { path: '/api/register',        limit:  3, window: 300_000 },
  { path: '/api/forgot-password', limit:  3, window: 300_000 },
  { path: '/api/reset-password',  limit:  5, window:  60_000 },
  { path: '/api/push/subscribe',  limit: 20, window:  60_000 },
];

const PROTECTED_PAGES = [
  '/dashboard', '/suivi', '/recapitulatif',
  '/budget', '/decaissements', '/parametres', '/ajout-retrait-fonds',
  '/projets', // D3 — planificateur projets
  "/analytiques",
];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const ip = (req.headers.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0].trim();

  // 1. Rate limiting persistant
  for (const rule of RATE_RULES) {
    if (pathname.startsWith(rule.path)) {
      const allowed = await checkRL(`${ip}:${rule.path}`, rule.limit, rule.window);
      if (!allowed) {
        const retryAfter = Math.ceil(rule.window / 1000);
        return new NextResponse(
          JSON.stringify({ error: `Trop de requetes. Reessayez dans ${retryAfter} secondes.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) } }
        );
      }
    }
  }

  // 2. CSRF mutations API
  const isMutation = ['POST','PUT','DELETE','PATCH'].includes(req.method.toUpperCase());
  const isApiRoute = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth');
  if (isMutation && isApiRoute) {
    const origin  = req.headers.get('origin')  ?? '';
    const referer = req.headers.get('referer') ?? '';
    const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? '';
    if (appUrl) {
      const allowed = new URL(appUrl).origin;
      const isCron  = pathname.startsWith('/api/push/cron');
      if (!isCron && !origin.startsWith(allowed) && !referer.startsWith(allowed)) {
        return new NextResponse(
          JSON.stringify({ error: 'Requete non autorisee (CSRF)' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // 3. Auth protection pages
  const isProtected = PROTECTED_PAGES.some(p => pathname.startsWith(p));
  if (isProtected) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(url);
    }
  }

  // 4. Headers securite
  // NOTE : microphone PAS restreint — requis pour Web Speech API (D1 vocal)
  const res = NextResponse.next();
  res.headers.set('X-Frame-Options',        'SAMEORIGIN');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-XSS-Protection',       '1; mode=block');
  res.headers.set('Referrer-Policy',        'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy',     'camera=(), geolocation=()');
  return res;
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
    '/projets/:path*',           // D3
    '/api/auth/:path*',
    '/api/register',
    '/api/forgot-password',
    '/api/reset-password',
    '/api/push/:path*',
  ],
};
