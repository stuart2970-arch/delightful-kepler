import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { POST as tenantCreated } from '../src/app/api/webhooks/tenant-created/route';

const root = process.cwd();
const WEBHOOK_SECRET = 'tenant-created-test-secret';
const PII_EMAIL = 'patron@example.test';
const PII_NAME = 'Ada Lovelace';
const PII_PHONE = '+447700900123';
const PII_NOTE = 'raw-payload-marker';

type FetchCall = { url: string; init?: RequestInit };

function payload() {
  return {
    record: {
      id: 'tenant_test_1',
      slug: 'salon-slug',
      company_name: PII_NAME,
      name: PII_NAME,
      email: PII_EMAIL,
      phone: PII_PHONE,
      token: 'payload-token-marker',
      note: PII_NOTE,
    },
  };
}

function postTenantCreated(authorization?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return new NextRequest('http://localhost:3001/api/webhooks/tenant-created', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload()),
  });
}

async function withIsolatedEnv(
  run: (ctx: { fetches: FetchCall[]; logs: string[] }) => Promise<void>,
) {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    WORDPRESS_SITE_URL: process.env.WORDPRESS_SITE_URL,
    STYLEFLO_WP_CREATE_BUSINESS_TOKEN: process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN,
    TENANT_CREATED_WEBHOOK_SECRET: process.env.TENANT_CREATED_WEBHOOK_SECRET,
  };
  const fetches: FetchCall[] = [];
  const logs: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const push = (args: unknown[]) => {
    logs.push(args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '));
  };

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetches.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, id: 'wp_test_page' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    console.log = (...args: unknown[]) => push(args);
    console.warn = (...args: unknown[]) => push(args);
    console.error = (...args: unknown[]) => push(args);
    await run({ fetches, logs });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function enablePublishConfig() {
  process.env.APP_ENV = 'production';
  process.env.NEXT_PUBLIC_ENV = 'production';
  process.env.WORDPRESS_SITE_URL = 'https://wp.example.test';
  process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'mock-create-business-token';
}

function assertNoPersonalData(serialized: string) {
  expect(serialized).not.toContain(PII_EMAIL);
  expect(serialized).not.toContain(PII_NAME);
  expect(serialized).not.toContain(PII_PHONE);
  expect(serialized).not.toContain(PII_NOTE);
  expect(serialized).not.toContain('payload-token-marker');
  expect(serialized).not.toContain(WEBHOOK_SECRET);
  expect(serialized).not.toContain('mock-create-business-token');
}

test.describe('STYL-239: tenant-created webhook requires a shared secret', () => {
  test('unauthenticated POST is 401 and does not call WordPress', async () => {
    await withIsolatedEnv(async ({ fetches, logs }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;

      const res = await tenantCreated(postTenantCreated());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(JSON.stringify(body)).not.toMatch(/wp_data|created successfully/i);
      expect(fetches).toHaveLength(0);
      assertNoPersonalData(logs.join('\n'));
    });
  });

  test('wrong Bearer of a different length is 401 and does not call WordPress', async () => {
    await withIsolatedEnv(async ({ fetches }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const different = `${WEBHOOK_SECRET}-no`;
      expect(different.length).not.toBe(WEBHOOK_SECRET.length);

      const res = await tenantCreated(postTenantCreated(`Bearer ${different}`));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(fetches).toHaveLength(0);
    });
  });

  test('wrong Bearer of the same length is 401 and does not call WordPress', async () => {
    await withIsolatedEnv(async ({ fetches }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const sameLength = 'x'.repeat(WEBHOOK_SECRET.length);
      expect(sameLength.length).toBe(WEBHOOK_SECRET.length);
      expect(sameLength).not.toBe(WEBHOOK_SECRET);

      const res = await tenantCreated(postTenantCreated(`Bearer ${sameLength}`));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(fetches).toHaveLength(0);
    });
  });

  test('missing or empty webhook secret fails closed with 401', async () => {
    await withIsolatedEnv(async ({ fetches }) => {
      enablePublishConfig();

      delete process.env.TENANT_CREATED_WEBHOOK_SECRET;
      const missing = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      expect(missing.status).toBe(401);
      expect(fetches).toHaveLength(0);

      process.env.TENANT_CREATED_WEBHOOK_SECRET = '   ';
      const blank = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      expect(blank.status).toBe(401);
      expect(fetches).toHaveLength(0);
    });
  });

  test('valid Bearer on staging passes auth and does not publish', async () => {
    await withIsolatedEnv(async ({ fetches, logs }) => {
      process.env.APP_ENV = 'staging';
      process.env.NEXT_PUBLIC_ENV = 'staging';
      process.env.WORDPRESS_SITE_URL = 'https://styleflo.ai';
      process.env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN = 'mock-create-business-token';
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;

      const res = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(JSON.stringify(body)).toMatch(/disabled on staging/i);
      expect(JSON.stringify(body)).not.toMatch(/wp_data|created successfully/i);
      expect(fetches.some((call) => call.url.includes('styleflo.ai'))).toBe(false);
      expect(fetches).toHaveLength(0);
      assertNoPersonalData(logs.join('\n'));
      expect(logs.join('\n')).toContain('salon-slug');
    });
  });

  test('valid Bearer with publish enabled calls the mocked WordPress endpoint once', async () => {
    await withIsolatedEnv(async ({ fetches, logs }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;

      const res = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(fetches).toHaveLength(1);
      expect(fetches[0].url).toBe('https://wp.example.test/wp-json/styleflo/v1/create-business');
      const sent = JSON.parse(String(fetches[0].init?.body));
      expect(sent.slug).toBe('salon-slug');
      expect(sent.title).toBe(PII_NAME);
      expect(sent.token).toBe('mock-create-business-token');
      expect(fetches[0].url.includes('styleflo.ai')).toBe(false);
      assertNoPersonalData(logs.join('\n'));
    });
  });

  test('WordPress error text is not echoed with personal data or the publish token', async () => {
    await withIsolatedEnv(async ({ fetches, logs }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetches.push({ url: String(input), init });
        return new Response(`rejected ${PII_EMAIL} token=mock-create-business-token`, { status: 422 });
      }) as typeof fetch;

      const res = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      const serialized = JSON.stringify(await res.json());

      expect(res.status).toBe(422);
      expect(fetches).toHaveLength(1);
      expect(serialized).not.toContain(PII_EMAIL);
      expect(serialized).not.toContain('mock-create-business-token');
      assertNoPersonalData(logs.join('\n'));
    });
  });

  test('error redaction runs before the log is truncated', async () => {
    await withIsolatedEnv(async ({ logs }) => {
      enablePublishConfig();
      process.env.TENANT_CREATED_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const lateToken = 'ef'.repeat(12);
      const body = `${'n'.repeat(189)} ${lateToken}`;
      globalThis.fetch = (async () => new Response(body, { status: 422 })) as typeof fetch;

      const res = await tenantCreated(postTenantCreated(`Bearer ${WEBHOOK_SECRET}`));
      const logged = logs.join('\n');

      expect(res.status).toBe(422);
      expect(logged).not.toContain(lateToken);
      expect(logged).not.toContain(lateToken.slice(0, 10));
    });
  });

  test('route checks the webhook secret before create-business and uses secretsEqual', () => {
    const src = readFileSync(join(root, 'src/app/api/webhooks/tenant-created/route.ts'), 'utf8');
    expect(src).toContain('TENANT_CREATED_WEBHOOK_SECRET');
    expect(src).toContain('secretsEqual');
    expect(src).toContain('getWordpressPublishConfig');
    expect(src).not.toContain("console.log('[Tenant Created Webhook] Triggered with payload:'");
    const secretIdx = src.indexOf('TENANT_CREATED_WEBHOOK_SECRET');
    const createIdx = src.indexOf('create-business');
    expect(secretIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(secretIdx);
  });
});
