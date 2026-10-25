import type { NextConfig } from "next";

const isStaging =
  (process.env.APP_ENV || process.env.NEXT_PUBLIC_ENV || "")
    .trim()
    .toLowerCase() === "staging";

// STYL-203: set BUILD-only in apphosting.yaml. Unset for local, CI, and Cloud Run
// Docker builds so those paths still typecheck (CI/deploy.yml already gate PRs).
const isAppHostingBuild = process.env.STYL_APPHOSTING_BUILD === "1";

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
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
