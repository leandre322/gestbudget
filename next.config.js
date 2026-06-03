const withPWA = require("next-pwa")({
  dest:            "public",
  register:        true,
  skipWaiting:     true,
  disable:         process.env.NODE_ENV === "development",
  customWorkerDir: "worker",
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

const securityHeaders = [
  { key: "X-Frame-Options",           value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-XSS-Protection",          value: "1; mode=block" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"] },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = withPWA(nextConfig);