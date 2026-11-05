import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { createTestUser, TestUserSession } from './test-auth-helper';
import { allowedBillingAppOrigin } from '../src/lib/billing/app-origin-cors';
import { resolvePortalConfigurationId } from '../src/lib/billing/portal-config';
import {
  billingPortalRateLimit,
  consumeMemoryRateLimit,
  resetBillingRateLimitsForTests,
} from '../src/lib/security/billing-rate-limit';

const ACME = '10000000-0000-0000-0000-000000000001';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OWNER_CFG = 'bpc_test_owner';
const ADMIN_CFG = 'bpc_test_admin';

function jsonHeaders(token?: string, extra: Record<string, string> = {}) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

test.describe('Billing checkout auth, portal configs, CORS, and rate limits', () => {
  let owner: TestUserSession;
  let admin: TestUserSession;
  let member: TestUserSession;
  let otherOwner: TestUserSession;
  let superadmin: TestUserSession;
  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    owner = await createTestUser({ tenantId: ACME, role: 'owner' });
    admin = await createTestUser({ tenantId: ACME, role: 'admin' });
    member = await createTestUser({ tenantId: ACME, role: 'member' });
    otherOwner = await createTestUser({ tenantId: GLOBEX, role: 'owner' });
    superadmin = await createTestUser({ tenantId: GLOBEX, role: 'owner', isSuperAdmin: true });
    await adminDb.from('tenants').update({ stripe_customer_id: 'cus_test_acme' }).eq('id', ACME);
  });

  test.afterAll(async () => {
    await adminDb.from('tenants').update({ stripe_customer_id: null }).eq('id', ACME);
    await owner?.cleanup();
    await admin?.cleanup();
    await member?.cleanup();
    await otherOwner?.cleanup();
    await superadmin?.cleanup();
  });

  for (const mode of [
    { name: 'portal', data: { action: 'portal' } },
    { name: 'bolt-on', data: { addonCatalogId: 'google_calendar_addon' } },
    { name: 'plan', data: { plan: 'foundation', planTier: 'base_tier' } },
  ]) {
    test(`unauthenticated ${mode.name} POST is 401`, async ({ request }) => {
      const res = await request.post('/api/billing/checkout', {
        headers: jsonHeaders(),
        data: mode.data,
      });
      expect(res.status()).toBe(401);
    });

    test(`member ${mode.name} POST is 403`, async ({ request }) => {
      const res = await request.post('/api/billing/checkout', {
        headers: jsonHeaders(member.token),
        data: mode.data,
      });
      expect(res.status()).toBe(403);
    });

    test(`other tenant owner sending this tenant id is 403 for ${mode.name}`, async ({ request }) => {
      const res = await request.post('/api/billing/checkout', {
        headers: jsonHeaders(otherOwner.token),
        data: { ...mode.data, tenantId: ACME },
      });
      expect(res.status()).toBe(403);
    });
  }

  test('owner portal uses the owner configuration id', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(owner.token),
      data: { action: 'portal', tenantId: ACME },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.configuration).toBe(OWNER_CFG);
    expect(body.url).toContain('stripe.com');
  });

  test('admin portal uses the admin (no-cancel) configuration id', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(admin.token),
      data: { action: 'portal' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.configuration).toBe(ADMIN_CFG);
  });

  test('superadmin portal uses the owner configuration and is audited', async ({ request }) => {
    await adminDb.from('tenants').update({ stripe_customer_id: 'cus_test_globex' }).eq('id', GLOBEX);
    const res = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(superadmin.token),
      data: { action: 'portal', tenantId: ACME },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.configuration).toBe(OWNER_CFG);
    await adminDb.from('tenants').update({ stripe_customer_id: null }).eq('id', GLOBEX);
  });

  test('owner config env missing falls back to admin and logs an error', () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };
    try {
      const resolved = resolvePortalConfigurationId(
        { role: 'owner', isSuperAdmin: false },
        { STRIPE_PORTAL_CONFIG_ADMIN: ADMIN_CFG },
      );
      expect(resolved.configurationId).toBe(ADMIN_CFG);
      expect(resolved.fellBackToAdmin).toBe(true);
      expect(String(errors[0] || '')).toMatch(/STRIPE_PORTAL_CONFIG_OWNER/);
    } finally {
      console.error = original;
    }
  });

  test('admin can start bolt-on checkout for the session tenant', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(admin.token),
      data: { addonCatalogId: 'data_pack_500', tenantId: GLOBEX },
    });
    expect(res.status()).toBe(403);
    const own = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(admin.token),
      data: { addonCatalogId: 'data_pack_500' },
    });
    expect(own.status()).toBe(200);
    const body = await own.json();
    expect(body.metadata?.tenant_id).toBe(ACME);
  });

  test('no stripe_customer_id plus customerEmail is 409 and does not write the tenant', async ({ request }) => {
    await adminDb.from('tenants').update({ stripe_customer_id: null }).eq('id', ACME);
    const res = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(owner.token),
      data: { action: 'portal', customerEmail: 'victim@example.com' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('no_billing_account');
    const { data: tenant } = await adminDb
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', ACME)
      .maybeSingle();
    expect(tenant?.stripe_customer_id).toBeFalsy();
    await adminDb.from('tenants').update({ stripe_customer_id: 'cus_test_acme' }).eq('id', ACME);
  });

  test('CORS: foreign origin OPTIONS has no allow header; app origin is allowed', async ({ request }) => {
    const appOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const foreign = await request.fetch('/api/billing/checkout', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(foreign.headers()['access-control-allow-origin']).toBeFalsy();

    const allowed = await request.fetch('/api/billing/checkout', {
      method: 'OPTIONS',
      headers: { Origin: new URL(appOrigin).origin },
    });
    expect(allowed.headers()['access-control-allow-origin']).toBe(new URL(appOrigin).origin);
  });

  test('off-origin returnUrl is replaced on portal and checkout branches', async ({ request }) => {
    const portal = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(owner.token),
      data: { action: 'portal', returnUrl: 'https://evil.example/phish' },
    });
    expect([200, 409]).toContain(portal.status());

    const boltOn = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(owner.token),
      data: {
        addonCatalogId: 'google_calendar_addon',
        returnUrl: 'https://evil.example/phish',
      },
    });
    expect(boltOn.status()).toBe(200);
    const boltBody = await boltOn.json();
    expect(boltBody.success_url).not.toContain('evil.example');
    expect(boltBody.cancel_url).not.toContain('evil.example');

    const plan = await request.post('/api/billing/checkout', {
      headers: jsonHeaders(owner.token),
      data: { plan: 'foundation', returnUrl: 'https://evil.example/phish' },
    });
    expect(plan.status()).toBe(200);
    const planBody = await plan.json();
    expect(planBody.success_url).not.toContain('evil.example');
    expect(planBody.cancel_url).not.toContain('evil.example');
  });
});

test.describe('Billing checkout source audits (no live services)', () => {
  test('in-memory billing rate limit returns false after the ceiling', () => {
    resetBillingRateLimitsForTests();
    expect(consumeMemoryRateLimit('portal-unit', 2)).toBe(true);
    expect(consumeMemoryRateLimit('portal-unit', 2)).toBe(true);
    expect(consumeMemoryRateLimit('portal-unit', 2)).toBe(false);
    expect(billingPortalRateLimit()).toBeGreaterThan(0);
  });

  test('route never lists Stripe customers by email or writes stripe_customer_id', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/app/api/billing/checkout/route.ts'), 'utf8');
    expect(src).not.toContain('customers.list');
    expect(src).not.toContain("update({ stripe_customer_id");
    expect(src).toContain('requireTenantRole');
    expect(src).toContain('safePublicReturnUrl');
    expect(src).toContain('no_billing_account');
    expect(src).toContain('status: 429');
    expect(src).not.toContain("Access-Control-Allow-Origin': '*'");
  });

  test('dashboard and upsell no longer send tenantId in the checkout body', () => {
    const dash = fs.readFileSync(path.resolve(__dirname, '../src/components/DashboardClient.tsx'), 'utf8');
    expect(dash).toContain("action: 'portal'");
    expect(dash).not.toMatch(/action:\s*'portal',\s*tenantId/);
    const upsell = fs.readFileSync(path.resolve(__dirname, '../src/components/AddOnUpsellModal.tsx'), 'utf8');
    expect(upsell).toContain('addonCatalogId');
    expect(upsell).not.toMatch(/addonCatalogId,\s*tenantId/);
  });

  test('every /api/billing/* POST handler uses requireTenantRole or withSuperAdmin and does not take tenantId from the body', () => {
    const billingDir = path.resolve(__dirname, '../src/app/api/billing');
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (entry === 'route.ts') routes.push(full);
      }
    };
    walk(billingDir);
    const postRoutes = routes.filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      return /export async function POST|export const POST/.test(src);
    });
    expect(postRoutes.length).toBeGreaterThan(0);
    for (const file of postRoutes) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(process.cwd(), file);
      const gated = src.includes('requireTenantRole') || src.includes('withSuperAdmin');
      expect(gated, `${rel} POST is not gated`).toBe(true);
      expect(src, rel).not.toMatch(/const\s*\{[^}]*\btenantId\b[^}]*\}\s*=\s*body/);
      expect(src, rel).not.toMatch(/tenantId\s*=\s*body\.tenantId/);
    }
  });

  test('CORS helper only reflects the configured app origin', () => {
    expect(allowedBillingAppOrigin({ APP_URL: 'https://staging.styleflo.ai/app' })).toBe(
      'https://staging.styleflo.ai',
    );
    expect(allowedBillingAppOrigin({ NEXT_PUBLIC_APP_URL: 'http://localhost:3001' })).toBe(
      'http://localhost:3001',
    );
  });

  test('portal setup script refuses live keys and is test-mode only', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/setup-stripe-portal-configs.js'), 'utf8');
    expect(src).toContain('sk_live_');
    expect(src).toContain('TEST_MODE_YES');
    expect(src).toContain('login_page');
    expect(src).toContain("subscription_update: { enabled: false }");
    expect(src).toContain("mode: 'at_period_end'");
  });
});
