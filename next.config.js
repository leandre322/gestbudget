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
    { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: "CacheFirst",
      options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 31536000 } } },
    { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i, handler: "CacheFirst",
      options: { cacheName: "gstatic-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 31536000 } } },
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

module.exports = withPWA(nextConfig);


// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "lawdigitals",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
