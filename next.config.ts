import type { NextConfig } from "next";

const nextConfig: any = {
  output: 'standalone',
  allowedDevOrigins: ['app.styleflo.test', 'styleflo.test'],
  // Ensure pdfjs-dist worker file is included in the standalone build output.
  // pdf-parse v2 uses pdfjs-dist v5 which requires the worker at runtime — without
  // this, the file is absent in production and PDFParse falls back to a broken fake worker.
  outputFileTracingIncludes: {
    '/api/ingest/file': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
  },
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
