const withPWA = require("next-pwa")({
  dest:            "public",
  register:        true,
  skipWaiting:     true,
  disable:         process.env.NODE_ENV === "development",
  customWorkerDir: "worker",
  // FIX : app-build-manifest.json est un fichier interne Next non servi en prod (404).
  // Sans cette exclusion, le precache Workbox echoue -> SW redondant -> jamais actif
  // -> navigator.serviceWorker.ready ne resout jamais -> spinner infini sur le bouton push.
  buildExcludes: [/app-build-manifest\.json$/],
  runtimeCaching: [
    { urlPattern: /\/_next\/static\/.*/i, handler: "CacheFirst",
      options: { cacheName: "next-static-cache", expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } } },
    { urlPattern: /\/_next\/image\/.*/i, handler: "StaleWhileRevalidate",
      options: { cacheName: "next-image-cache", expiration: { maxEntries: 50, maxAgeSeconds: 604800 } } },
  ],
});

// NOTE : les headers de securite sont geres UNIQUEMENT dans middleware.ts.
// Auparavant ils etaient dupliques ici avec "microphone=()" qui ecrasait
// l'intention du middleware (microphone autorise pour la dictee vocale / Web Speech API).
// Un seul point de verite = plus de conflit. HSTS a ete deplace dans le middleware.
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"] },
};

const { withSentryConfig } = require("@sentry/nextjs");

// ─────────────────────────────────────────────────────────────────────────────
// S23 / P132 — trois corrections
//
//   1. FORME. Le wizard avait produit `module.exports = withPWA(nextConfig)`
//      puis, plus bas, `module.exports = withSentryConfig(module.exports, ...)`.
//      Fonctionnel en CommonJS (module.exports est evalue avant la
//      reaffectation) mais illisible : la composition est desormais explicite.
//
//   2. sentryUrl — CAUSE DU 401 AU BUILD (S23 / Q19).
//      Le DSN de sentry.client.config.ts pointe sur ingest.DE.sentry.io :
//      l organisation `lawdigitals` est hebergee en region EUROPE. Sans
//      sentryUrl, le plugin presente SENTRY_AUTH_TOKEN a l API US, qui le
//      refuse en 401. Seul l upload des SOURCE MAPS echouait — l ingestion
//      cliente, elle, fonctionne. Les traces etaient donc remontees mais
//      MINIFIEES.
//
//   3. OPTIONS A LA RACINE. `automaticVercelMonitors` et `treeshake` etaient
//      imbriques sous une cle `webpack`. Sur @sentry/nextjs v10 ces options
//      sont attendues a la racine ; une cle inconnue est ignoree EN SILENCE,
//      donc automaticVercelMonitors ne faisait vraisemblablement rien.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = withSentryConfig(withPWA(nextConfig), {
  org:     "lawdigitals",
  project: "javascript-nextjs",

  // Region EU — voir point 2 ci-dessus.
  sentryUrl: "https://de.sentry.io/",

  // Logs d upload uniquement en CI.
  silent: !process.env.CI,

  // Source maps plus completes, au prix d un build plus long.
  widenClientFileUpload: true,

  // Instrumentation automatique des Vercel Cron Monitors.
  automaticVercelMonitors: true,

  // Retire les appels de log Sentry du bundle client.
  disableLogger: true,
});