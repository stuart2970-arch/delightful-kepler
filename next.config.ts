import type { NextConfig } from "next";

const isStaging =
  (process.env.APP_ENV || process.env.NEXT_PUBLIC_ENV || "")
    .trim()
    .toLowerCase() === "staging";

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
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
