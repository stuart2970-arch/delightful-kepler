import { test, expect, type Page } from '@playwright/test';

process.env.PLAYWRIGHT_TEST = 'true';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createTestUser, type TestUserSession } from './test-auth-helper';
import {
  clearPlaywrightFoundationSubscriptionFixture,
  listStripeCustomerSubscriptions,
  loadFoundationStripePriceIds,
  lookupHasActiveFoundationSubscription,
  subscriptionListHasActiveFoundation,
  writePlaywrightFoundationSubscriptionFixture,
  type FoundationSubscriptionSummary,
} from '../src/lib/billing/foundation-subscription';

/**
 * STYL-413 Subscribe to Foundation.
 * Local Supabase only. Stripe is a fixture while PLAYWRIGHT_TEST=true.
 * The button follows hasActiveFoundationSubscription, not plan_tier.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const ACME = '10000000-0000-0000-0000-000000000001';
const FOUNDATION_PRICE = 'price_styl413_foundation';
const OTHER_PRICE = 'price_styl413_bolt_on';
const PASSWORD = 'Password123!';

type TierPrice = { id: string; stripe_price_id: string | null };

function foundationSubscription(status: string, priceId: string): FoundationSubscriptionSummary {
  return {
    status,
    items: {
      data: [
        {
          price: {
            id: priceId,
          },
        },
      ],
    },
  };
}

function fakeTierClient(rows: TierPrice[]) {
  return {
    from(table: string) {
      if (table !== 'subscription_tiers') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return this;
        },
        in() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

async function loginWithPassword(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
}

async function openBillingTab(page: Page) {
  const account = page.waitForResponse(
    (res) => res.url().includes('/api/billing/account') && res.request().method() === 'GET',
  );
  await page.locator('nav').locator('text=Subscriptions & Bolt-ons').first().click();
  const response = await account;
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('Foundation subscription matcher', () => {
  test('matches billable statuses by price id, not by a Foundation name', () => {
    const prices = [FOUNDATION_PRICE];
    expect(subscriptionListHasActiveFoundation([
      foundationSubscription('active', FOUNDATION_PRICE),
    ], prices)).toBe(true);
    expect(subscriptionListHasActiveFoundation([
      foundationSubscription('trialing', FOUNDATION_PRICE),
    ], prices)).toBe(true);
    expect(subscriptionListHasActiveFoundation([
      foundationSubscription('past_due', FOUNDATION_PRICE),
    ], prices)).toBe(true);
    expect(subscriptionListHasActiveFoundation([
      foundationSubscription('canceled', FOUNDATION_PRICE),
    ], prices)).toBe(false);
    expect(subscriptionListHasActiveFoundation([
      {
        status: 'active',
        items: { data: [{ price: { id: OTHER_PRICE } }] },
      },
    ], prices)).toBe(false);
    expect(subscriptionListHasActiveFoundation([], prices)).toBe(false);
    expect(subscriptionListHasActiveFoundation([
      foundationSubscription('active', FOUNDATION_PRICE),
    ], [])).toBe(false);
  });

  test('lists the customer subscriptions with status all and limit 20', async () => {
    const calls: Array<{ customer: string; status: string; limit: number }> = [];
    const listed = await listStripeCustomerSubscriptions({
      list: async (params) => {
        calls.push(params);
        return {
          data: [foundationSubscription('active', FOUNDATION_PRICE)],
        };
      },
    }, 'cus_fake');
    expect(calls).toEqual([{ customer: 'cus_fake', status: 'all', limit: 20 }]);
    expect(listed).toHaveLength(1);
  });

  test('reads Foundation price ids from subscription_tiers and skips blanks', async () => {
    const ids = await loadFoundationStripePriceIds(fakeTierClient([
      { id: 'foundation', stripe_price_id: ` ${FOUNDATION_PRICE} ` },
      { id: 'base_tier', stripe_price_id: 'price_styl413_base' },
      { id: 'foundation', stripe_price_id: '   ' },
    ]));
    expect(ids.sort()).toEqual([FOUNDATION_PRICE, 'price_styl413_base'].sort());
  });

  test('no Stripe customer is false and does not list subscriptions', async () => {
    let listed = false;
    const result = await lookupHasActiveFoundationSubscription({
      supabase: {
        from() {
          listed = true;
          throw new Error('should not read tiers');
        },
      },
      stripeCustomerId: null,
      stripe: {
        subscriptions: {
          list: async () => {
            listed = true;
            return { data: [] };
          },
        },
      },
    });
    expect(result).toBe(false);
    expect(listed).toBe(false);
  });

  test('a Stripe error is unknown and is logged', async () => {
    writePlaywrightFoundationSubscriptionFixture({
      cus_styl413_unit_error: { error: 'stripe unavailable' },
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(' '));
    };
    try {
      const result = await lookupHasActiveFoundationSubscription({
        supabase: fakeTierClient([{ id: 'foundation', stripe_price_id: FOUNDATION_PRICE }]),
        stripeCustomerId: 'cus_styl413_unit_error',
      });
      expect(result).toBeNull();
      expect(errors.join('\n')).toContain('stripe unavailable');
    } finally {
      console.error = original;
      clearPlaywrightFoundationSubscriptionFixture();
    }
  });
});

test.describe('STYL-413 Subscribe to Foundation', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;
  let owner: TestUserSession;
  let email = '';
  let savedPrices: TierPrice[] = [];
  let savedCustomer: string | null = null;

  test.beforeAll(async () => {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clearPlaywrightFoundationSubscriptionFixture();
    const { data: tiers, error: tierReadError } = await admin
      .from('subscription_tiers')
      .select('id, stripe_price_id')
      .in('id', ['foundation', 'base_tier']);
    expect(tierReadError).toBeNull();
    savedPrices = (tiers || []) as TierPrice[];
    const { error: tierWriteError } = await admin
      .from('subscription_tiers')
      .update({ stripe_price_id: FOUNDATION_PRICE })
      .in('id', ['foundation', 'base_tier']);
    expect(tierWriteError).toBeNull();

    const { data: tenant, error: tenantReadError } = await admin
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', GLOBEX)
      .maybeSingle();
    expect(tenantReadError).toBeNull();
    savedCustomer = tenant?.stripe_customer_id ?? null;

    owner = await createTestUser({ tenantId: GLOBEX, role: 'owner' });
    email = owner.user.email as string;
  });

  test.afterAll(async () => {
    clearPlaywrightFoundationSubscriptionFixture();
    if (admin) {
      for (const row of savedPrices) {
        await admin.from('subscription_tiers').update({ stripe_price_id: row.stripe_price_id }).eq('id', row.id);
      }
      await admin.from('tenants').update({ stripe_customer_id: savedCustomer }).eq('id', GLOBEX);
    }
    if (owner) await owner.cleanup();
  });

  test.beforeEach(async () => {
    const { error } = await admin
      .from('tenants')
      .update({
        stripe_customer_id: null,
        plan_tier: 'foundation',
        subscription_status: 'active',
      })
      .eq('id', GLOBEX);
    expect(error).toBeNull();
    clearPlaywrightFoundationSubscriptionFixture();
  });

  test('a tenant with no Stripe customer sees the button and posts the Foundation plan', async ({ page }) => {
    const { data: tenant } = await admin
      .from('tenants')
      .select('plan_tier, subscription_status, stripe_customer_id')
      .eq('id', GLOBEX)
      .maybeSingle();
    expect(tenant?.plan_tier).toBe('foundation');
    expect(tenant?.subscription_status).toBe('active');
    expect(tenant?.stripe_customer_id).toBeFalsy();

    await loginWithPassword(page, email);
    await page.route('https://checkout.stripe.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Checkout</title><p>Checkout</p>',
      });
    });
    const body = await openBillingTab(page);
    expect(body.hasActiveFoundationSubscription).toBe(false);
    expect(body.tenant_id).toBe(GLOBEX);
    await expect(page.getByTestId('foundation-subscription-state')).toHaveAttribute('data-state', 'inactive');

    const checkoutRequest = page.waitForRequest(
      (req) => req.url().includes('/api/billing/checkout') && req.method() === 'POST',
    );
    await page.getByTestId('subscribe-foundation').click();
    const request = await checkoutRequest;
    expect(request.postDataJSON()).toEqual({ plan: 'foundation' });
    await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 20000 });
  });

  test('an active Foundation subscription hides the button and checkout returns 409', async ({ page, request }) => {
    const customerId = 'cus_styl413_active';
    const { error } = await admin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', GLOBEX);
    expect(error).toBeNull();
    writePlaywrightFoundationSubscriptionFixture({
      [customerId]: {
        subscriptions: [foundationSubscription('active', FOUNDATION_PRICE)],
      },
    });

    const account = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(account.status()).toBe(200);
    expect((await account.json()).hasActiveFoundationSubscription).toBe(true);

    const checkout = await request.post('/api/billing/checkout', {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
      },
      data: { plan: 'foundation' },
    });
    expect(checkout.status()).toBe(409);
    const checkoutBody = await checkout.json();
    expect(checkoutBody.code).toBe('foundation_subscription_exists');
    expect(checkoutBody.url).toBeUndefined();

    const foreign = await request.post('/api/billing/checkout', {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
      },
      data: { plan: 'foundation', tenantId: ACME },
    });
    expect(foreign.status()).toBe(403);

    await loginWithPassword(page, email);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const ui = await openBillingTab(page);
    expect(ui.hasActiveFoundationSubscription).toBe(true);
    await expect(page.getByRole('heading', { name: /Current plan =/i })).toBeVisible();
    await expect(page.getByTestId('foundation-subscription-state')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('subscribe-foundation')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('a cancelled Foundation subscription shows the button', async ({ page, request }) => {
    const customerId = 'cus_styl413_cancelled';
    const { error } = await admin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', GLOBEX);
    expect(error).toBeNull();
    writePlaywrightFoundationSubscriptionFixture({
      [customerId]: {
        subscriptions: [foundationSubscription('canceled', FOUNDATION_PRICE)],
      },
    });

    const account = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect((await account.json()).hasActiveFoundationSubscription).toBe(false);

    const checkout = await request.post('/api/billing/checkout', {
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
      },
      data: { plan: 'foundation', tenantId: GLOBEX },
    });
    expect(checkout.status()).toBe(200);
    const checkoutBody = await checkout.json();
    expect(checkoutBody.url).toContain('checkout.stripe.com');
    expect(checkoutBody.metadata?.tenant_id).toBe(GLOBEX);

    await loginWithPassword(page, email);
    await openBillingTab(page);
    await expect(page.getByTestId('foundation-subscription-state')).toHaveAttribute('data-state', 'inactive');
    await expect(page.getByTestId('subscribe-foundation')).toBeVisible();
  });

  test('a Stripe error hides the button and does not crash the billing tab', async ({ page, request }) => {
    const customerId = 'cus_styl413_error';
    const { error } = await admin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', GLOBEX);
    expect(error).toBeNull();
    writePlaywrightFoundationSubscriptionFixture({
      [customerId]: { error: 'stripe unavailable' },
    });

    const account = await request.get('/api/billing/account', {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(account.status()).toBe(200);
    expect((await account.json()).hasActiveFoundationSubscription).toBeNull();

    await loginWithPassword(page, email);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const ui = await openBillingTab(page);
    expect(ui.hasActiveFoundationSubscription).toBeNull();
    await expect(page.getByRole('heading', { name: /Current plan =/i })).toBeVisible();
    await expect(page.getByTestId('foundation-subscription-state')).toHaveAttribute('data-state', 'unknown');
    await expect(page.getByTestId('subscribe-foundation')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('an active subscription on another price still shows the button', async ({ page }) => {
    const customerId = 'cus_styl413_other';
    const { error } = await admin.from('tenants').update({ stripe_customer_id: customerId }).eq('id', GLOBEX);
    expect(error).toBeNull();
    writePlaywrightFoundationSubscriptionFixture({
      [customerId]: {
        subscriptions: [foundationSubscription('active', OTHER_PRICE)],
      },
    });

    await loginWithPassword(page, email);
    const ui = await openBillingTab(page);
    expect(ui.hasActiveFoundationSubscription).toBe(false);
    await expect(page.getByTestId('foundation-subscription-state')).toHaveAttribute('data-state', 'inactive');
    await expect(page.getByTestId('subscribe-foundation')).toBeVisible();
  });
});
