import type { NextConfig } from "next";

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    return [
      {
        source: '/turnstile.html',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *"
          }
        ],
      },
      {
        source: '/:path((?!turnstile\\.html).*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://styleflo.ai https://*.styleflo.ai http://styleflo.test:* http://styleflo.test http://*.styleflo.test:*"
          }
        ],
      },
    ];
  },
};

export default nextConfig;
