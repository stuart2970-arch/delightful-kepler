import { test, expect } from '@playwright/test';
import { createServer, type AddressInfo } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { POST as tenantCreated } from '../src/app/api/webhooks/tenant-created/route';
import { publishBusinessPageForTenant } from '../src/lib/tenants/publish-business-page';
import {
  buildWordpressCreateBusinessBody,
  classifyWordpressHttpFailure,
  postWordpressCreateBusiness,
} from '../src/lib/wordpress/wordpress-api';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

test.describe('STYL-251 WordPress publish diagnostics and slug rollback', () => {
  test('classifies WordPress 401 rest_forbidden separately from token mismatch', () => {
    const forbidden = classifyWordpressHttpFailure(
      401,
      JSON.stringify({ code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.', data: { status: 401 } }),
    );
    expect(forbidden.kind).toBe('auth_forbidden');

    const token = classifyWordpressHttpFailure(
      401,
      JSON.stringify({ code: 'invalid_token', message: 'Invalid token' }),
    );
    expect(token.kind).toBe('token_mismatch');
  });

  test('create-business request body carries token in JSON only', () => {
    const body = buildWordpressCreateBusinessBody('acme', 'Acme Ltd', 'secret-token-value');
    const parsed = JSON.parse(body) as { slug: string; title: string; token: string };
    expect(parsed).toEqual({ slug: 'acme', title: 'Acme Ltd', token: 'secret-token-value' });
    expect(body).not.toContain('Authorization');
  });

  test('redactWordpressBody redacts quoted JSON token keys', () => {
    const body = '{"token":"super-secret","message":"fail"}';
    const classified = classifyWordpressHttpFailure(401, body);
    expect(classified.logDetail).not.toContain('super-secret');
    expect(classified.logDetail).toContain('[redacted]');
  });

  test('postWordpressCreateBusiness maps 401 without logging token values', async () => {
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({ code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' }),
        { status: 401 },
      )) as typeof fetch;

    const result = await postWordpressCreateBusiness(
      { enabled: true, wordpressSiteUrl: 'https://wp.test', token: 'super-secret' },
      'slug',
      'Title',
      mockFetch,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('auth_forbidden');
    expect(result.logDetail).not.toContain('super-secret');
  });

  test('failed manual publish leaves tenant slug unchanged', async () => {
    test.skip(!anonKey || !serviceKey, 'Requires local Supabase keys');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const originalSlug = `styl251-${Date.now()}`;
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ slug: originalSlug, company_name: 'Before publish' })
      .select('id')
      .single();
    expect(tenantErr).toBeNull();

    const previous = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
      STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
    };
    const originalFetch = globalThis.fetch;

  const wpServer = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' }));
    });
    await new Promise<void>((resolve) => wpServer.listen(0, '127.0.0.1', () => resolve()));
    const wpPort = (wpServer.address() as AddressInfo).port;

    try {
      process.env.APP_ENV = 'production';
      process.env.NEXT_PUBLIC_ENV = 'production';
      process.env.WORDPRESS_SITE_URL = `http://127.0.0.1:${wpPort}`;
      process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'mock-wp-token';
      globalThis.fetch = originalFetch;

      const result = await publishBusinessPageForTenant(
        admin,
        tenant!.id as string,
        'Renamed Business Name',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBeGreaterThanOrEqual(400);
        expect(result.wordpressError).toBe('auth_forbidden');
      }

      const { data: row } = await admin.from('tenants').select('slug, company_name').eq('id', tenant!.id).single();
      expect(row?.slug).toBe(originalSlug);
      expect(row?.company_name).toBe('Before publish');
    } finally {
      await new Promise<void>((resolve, reject) => {
        wpServer.close((error) => (error ? reject(error) : resolve()));
      });
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value as string;
      }
      await admin.from('tenants').delete().eq('id', tenant!.id);
    }
  });

  test('concurrent publishes of the same name reserve distinct slugs (STYL-399)', async () => {
    test.skip(!serviceKey, 'Requires local Supabase service role key');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const stamp = Date.now();
    const sharedName = 'Concurrent Coffee';
    const { data: tenantA, error: errA } = await admin
      .from('tenants')
      .insert({ slug: `styl399-a-${stamp}`, company_name: 'Tenant A' })
      .select('id')
      .single();
    const { data: tenantB, error: errB } = await admin
      .from('tenants')
      .insert({ slug: `styl399-b-${stamp}`, company_name: 'Tenant B' })
      .select('id')
      .single();
    expect(errA).toBeNull();
    expect(errB).toBeNull();

    const wpSlugs: string[] = [];
    const wpServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(body) as { slug: string };
        wpSlugs.push(parsed.slug);
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }, 40);
      });
    });

    const previous = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
      WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
      STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
    };

    await new Promise<void>((resolve) => wpServer.listen(0, '127.0.0.1', () => resolve()));
    const wpPort = (wpServer.address() as AddressInfo).port;

    try {
      process.env.APP_ENV = 'production';
      process.env.NEXT_PUBLIC_ENV = 'production';
      process.env.WORDPRESS_SITE_URL = `http://127.0.0.1:${wpPort}`;
      process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'mock-wp-token';

      const [resultA, resultB] = await Promise.all([
        publishBusinessPageForTenant(admin, tenantA!.id as string, sharedName),
        publishBusinessPageForTenant(admin, tenantB!.id as string, sharedName),
      ]);

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (!resultA.ok || !resultB.ok) return;

      expect(resultA.finalSlug).not.toBe(resultB.finalSlug);
      expect(new Set(wpSlugs).size).toBe(2);
      expect(wpSlugs).toEqual(expect.arrayContaining([resultA.finalSlug, resultB.finalSlug]));

      const { count } = await admin
        .from('tenant_publish_slug_claims')
        .select('*', { count: 'exact', head: true });
      expect(count).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        wpServer.close((error) => (error ? reject(error) : resolve()));
      });
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value as string;
      }
      await admin.from('tenants').delete().in('id', [tenantA!.id as string, tenantB!.id as string]);
    }
  });

  test('tenant-created returns classified WordPress error without token leak', async () => {
    const previous = {
      APP_ENV: process.env.APP_ENV,
      TENANT_CREATED_WEBHOOK_SECRET: process.env.TENANT_CREATED_WEBHOOK_SECRET,
      WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
      STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
    };
    const originalFetch = globalThis.fetch;

    try {
      process.env.APP_ENV = 'production';
      process.env.TENANT_CREATED_WEBHOOK_SECRET = 'styl251-webhook-secret';
      process.env.WORDPRESS_SITE_URL = 'https://wp-mock.test';
      process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'leaky-token';

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ code: 'rest_forbidden' }), { status: 401 })) as typeof fetch;

      const res = await tenantCreated(
        new Request('http://localhost/api/webhooks/tenant-created', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer styl251-webhook-secret',
          },
          body: JSON.stringify({
            record: { slug: 'styl251-hook', company_name: 'Hook Co', page_published: true },
          }),
        }),
      );
      const json = (await res.json()) as { error?: string; wordpressError?: string };
      expect(res.status).toBe(401);
      expect(json.wordpressError).toBe('auth_forbidden');
      expect(JSON.stringify(json)).not.toContain('leaky-token');
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value as string;
      }
    }
  });
});