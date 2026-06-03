import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// ── Rate limiter in-memory ───────────────────────────────────────────────────
const rlMap = new Map<string, { count: number; resetAt: number }>();

function checkRL(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlMap.get(key);
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= limit) return false;
  e.count++;
  return true;
}

// Nettoyage periodique (evite la fuite memoire)
setInterval(() => {
  const now = Date.now();
  rlMap.forEach((v, k) => { if (now > v.resetAt) rlMap.delete(k); });
}, 60_000);

const RATE_RULES = [
  { path: '/api/auth',           limit: 10, window: 60_000 },
  { path: '/api/register',       limit:  5, window: 60_000 },
  { path: '/api/forgot-password',limit:  5, window: 60_000 },
  { path: '/api/reset-password', limit:  5, window: 60_000 },
  { path: '/api/push/subscribe', limit: 20, window: 60_000 },
];

const PROTECTED_PAGES = [
  '/dashboard', '/suivi', '/recapitulatif',
  '/budget', '/decaissements', '/parametres', '/ajout-retrait-fonds',
];

// ── Middleware principal ─────────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const ip = (req.headers.get('x-forwarded-for') ?? '127.0.0.1').split(',')[0].trim();

  // 1. Rate limiting
  for (const rule of RATE_RULES) {
    if (pathname.startsWith(rule.path)) {
      if (!checkRL(`${ip}:${rule.path}`, rule.limit, rule.window)) {
        return new NextResponse(
          JSON.stringify({ error: 'Trop de requetes. Reessayez dans 60 secondes.' }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
        );
      }
    }
  }

  // 1b. CSRF pour mutations API (sauf auth NextAuth qui a son propre CSRF)
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

  // 2. Auth protection pages
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

  // 3. Headers securite
  const res = NextResponse.next();
  res.headers.set('X-Frame-Options',           'SAMEORIGIN');
  res.headers.set('X-Content-Type-Options',    'nosniff');
  res.headers.set('X-XSS-Protection',          '1; mode=block');
  res.headers.set('Referrer-Policy',           'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy',        'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  matcher: [
    '/dashboard/:path*', '/suivi/:path*', '/recapitulatif/:path*',
    '/budget/:path*', '/decaissements/:path*', '/parametres/:path*',
    '/ajout-retrait-fonds/:path*',
    '/api/auth/:path*', '/api/register', '/api/forgot-password',
    '/api/reset-password', '/api/push/:path*',
  ],
};