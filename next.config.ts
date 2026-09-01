import type { NextConfig } from "next";

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
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
