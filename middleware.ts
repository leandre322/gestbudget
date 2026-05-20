export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/suivi/:path*',
    '/recapitulatif/:path*',
    '/budget/:path*',
    '/decaissements/:path*',
    '/parametres/:path*',
  ],
};
