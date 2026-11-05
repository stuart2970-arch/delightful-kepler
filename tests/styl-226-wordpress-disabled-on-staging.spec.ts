import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { POST as publishPage } from '../src/app/api/tenants/publish-page/route';
import { POST as tenantCreated } from '../src/app/api/webhooks/tenant-created/route';
import { getWordpressPublishConfig } from '../src/lib/env/wordpress-publish';

const root = process.cwd();
const HARD_CODED_WP_TOKEN = 'd1f5e82b79a83604f05c48b2';

test.describe('STYL-226: WordPress publishing disabled on staging', () => {
  test('helper refuses staging and missing config without a live fallback', () => {
    expect(getWordpressPublishConfig({ APP_ENV: 'staging' })).toEqual({
      enabled: false,
      reason: 'Publishing to WordPress is disabled on staging',
    });
    const missing = getWordpressPublishConfig({ APP_ENV: 'production' });
    expect(missing.enabled).toBe(false);
    expect(missing.enabled === false && missing.reason).toMatch(/not configured/i);
  });

  test('publish routes have no live WordPress fallback or hard-coded token', () => {
    for (const rel of [
      'src/app/api/tenants/publish-page/route.ts',
      'src/app/api/webhooks/tenant-created/route.ts',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toContain('getWordpressPublishConfig');
      expect(src, rel).not.toContain("|| 'https://styleflo.ai'");
      expect(src, rel).not.toContain(HARD_CODED_WP_TOKEN);
    }
  });

  test('publish-page and tenant-created do not fetch styleflo.ai on staging', async () => {
    const previous = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
      STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
    };
    const fetches: string[] = [];
    const originalFetch = globalThis.fetch;

    try {
      process.env.APP_ENV = 'staging';
      process.env.NEXT_PUBLIC_ENV = 'staging';
      delete process.env.WORDPRESS_SITE_URL;
      delete process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetches.push(String(input));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const publishReq = new NextRequest('http://localhost:3001/api/tenants/publish-page', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 't0000000-0000-0000-0000-000000000001',
          businessName: 'Staging WP Guard',
        }),
      });
      const publishRes = await publishPage(publishReq);
      const publishJson = await publishRes.json();
      expect(fetches.some((url) => url.includes('styleflo.ai'))).toBe(false);
      expect(JSON.stringify(publishJson)).not.toContain(HARD_CODED_WP_TOKEN);

      const createdReq = new NextRequest('http://localhost:3001/api/webhooks/tenant-created', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'staging-wp-guard',
          company_name: 'Staging WP Guard',
        }),
      });
      const createdRes = await tenantCreated(createdReq);
      const createdJson = await createdRes.json();
      expect(JSON.stringify(createdJson)).toMatch(/disabled on staging/i);
      expect(fetches.some((url) => url.includes('styleflo.ai'))).toBe(false);
      expect(JSON.stringify(createdJson)).not.toContain(HARD_CODED_WP_TOKEN);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
