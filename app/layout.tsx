import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import * as Sentry from '@sentry/nextjs';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';

// I20 / P77 : Inter est desormais auto-hebergee par next/font/google.
// Les <link> vers fonts.googleapis.com et fonts.gstatic.com violaient
// style-src ET font-src de la CSP (lib/csrf.ts). Plus aucune requete
// tierce au chargement : la police est servie depuis /_next/static.
// Inter est une police VARIABLE : ne pas passer "weight" ici.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export function generateMetadata(): Metadata {
  return {
    title:       'GestBudget',
    description: 'Application de gestion de budget mensuel personnel',
    manifest:    '/manifest.json',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'GestBudget' },
    other: {
      ...Sentry.getTraceData(),
      // P82 : appleWebApp.capable emet apple-mobile-web-app-capable, deprecie.
      // On conserve l ancienne pour les iOS anciens et on ajoute la standard.
      'mobile-web-app-capable': 'yes',
    },
  };
}

export const viewport: Viewport = { themeColor: '#3B82F6' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Evite le flash de couleur au chargement.
            Ce script inline impose 'unsafe-inline' dans script-src :
            contrainte assumee tant que la CSP reste sans nonce. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('gestbudget-theme');
              if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
              }
            } catch(e) {}
          })();
        `}} />
      </head>
      {/*
        PAS de bg-[var(--bg)] ici -- body est transparent pour laisser
        l aurora de html se voir a travers les surfaces glass.
        La couleur de fond vient de globals.css (html background).
      */}
      <body className="font-sans antialiased text-[var(--text)]">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}