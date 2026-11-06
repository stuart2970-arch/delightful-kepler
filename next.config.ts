import type { NextConfig } from "next";

const isStaging =
  (process.env.APP_ENV || process.env.NEXT_PUBLIC_ENV || "")
    .trim()
    .toLowerCase() === "staging";

// STYL-203: set BUILD-only in apphosting.yaml. Unset for local, CI, and Cloud Run
// Docker builds so those paths still typecheck (CI/deploy.yml already gate PRs).
const isAppHostingBuild = process.env.STYL_APPHOSTING_BUILD === "1";

const playwrightServer = process.env.PLAYWRIGHT_TEST === 'true';

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
  // The Playwright dev server compiles every route. Drop inactive pages and
  // skip the webpack cache so a long run does not exhaust the machine.
  ...(playwrightServer
    ? {
        onDemandEntries: {
          maxInactiveAge: 15 * 1000,
          pagesBufferLength: 2,
        },
      }
    : {}),
  // Next.js 16 defaults `next build` and `next dev` to Turbopack. A `webpack`
  // hook with no `turbopack` key makes that build exit 1
  // ("This build is using Turbopack, with a `webpack` config and no `turbopack` config").
  // The hook below is a no-op in production (`dev` is false). An empty turbopack
  // config keeps App Hosting on Turbopack, which is what previously shipped.
  // The Firebase adapter spreads this object and only sets images.unoptimized,
  // so this key is still present when that overlay runs.
  turbopack: {},
  webpack: (config: { devtool?: false | string; cache?: false | object }, { dev }: { dev: boolean }) => {
    if (dev && playwrightServer) {
      config.devtool = false;
      config.cache = false;
    }
    return config;
  },
  typescript: {
    // App Hosting e2-medium (~4 GB) OOMs during next build's embedded tsc.
    // Skip only on App Hosting; Playwright workflow + deploy.yml still run tsc.
    ignoreBuildErrors: isAppHostingBuild,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    const stagingNoIndex = isStaging
      ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
      : [];

    return [
      {
        source: '/turnstile.html',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *"
          },
          ...stagingNoIndex,
        ],
      },
      {
        source: '/:path((?!turnstile\\.html).*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            // STYL-203: allow staging App Hosting host (+ optional custom domain) for widget embeds.
            value:
              "frame-ancestors 'self' https://styleflo.ai https://*.styleflo.ai https://*.hosted.app https://*.web.app http://styleflo.test:* http://styleflo.test http://*.styleflo.test:*"
          },
          ...stagingNoIndex,
        ],
      },
    ];
  },
};

export default nextConfig;
