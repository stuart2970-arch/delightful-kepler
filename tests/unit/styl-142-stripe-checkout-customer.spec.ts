import { test, expect } from '@playwright/test';
import {
  ensureTenantStripeCustomerForSubscription,
} from '../../src/lib/billing/stripe-tenant-customer';

const TENANT_ID = '10000000-0000-0000-0000-000000000142';

function createMockStripe() {
  let createCount = 0;
  const customers = {
    async create(
      params: { email?: string; metadata?: Record<string, string> },
      options?: { idempotencyKey?: string },
    ) {
      createCount += 1;
      expect(options?.idempotencyKey).toBe(`cust-${TENANT_ID}`);
      expect(params.metadata?.tenant_id).toBe(TENANT_ID);
      return { id: 'cus_created_142', email: params.email, metadata: params.metadata };
    },
    async search() {
      return { data: [] as Array<{ id: string }> };
    },
    async list() {
      return { data: [] as Array<{ id: string; email?: string }> };
    },
    async update() {
      return {};
    },
    get createCount() {
      return createCount;
    },
  };

  return {
    customers,
    get createCount() {
      return customers.createCount;
    },
  };
}

function createTenantSupabase() {
  let stripeCustomerId: string | null = null;
  return {
    from(table: string) {
      if (table !== 'tenants') throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, unknown]> = [];
      const isFilters: Array<[string, unknown]> = [];
      let pendingUpdate: Record<string, unknown> | null = null;

      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return api;
        },
        is(col: string, val: unknown) {
          isFilters.push([col, val]);
          return api;
        },
        update(payload: Record<string, unknown>) {
          pendingUpdate = payload;
          return api;
        },
        async maybeSingle() {
          if (pendingUpdate) {
            const idOk = filters.some(([c, v]) => c === 'id' && v === TENANT_ID);
            const nullOnly = isFilters.some(([c, v]) => c === 'stripe_customer_id' && v === null);
            if (idOk && (stripeCustomerId === null || !nullOnly)) {
              if (stripeCustomerId === null || nullOnly) {
                stripeCustomerId = String(pendingUpdate.stripe_customer_id);
                return { data: { stripe_customer_id: stripeCustomerId }, error: null };
              }
              return { data: null, error: null };
            }
            pendingUpdate = null;
          }
          const idOk = filters.some(([c, v]) => c === 'id' && v === TENANT_ID);
          return {
            data: idOk ? { stripe_customer_id: stripeCustomerId } : null,
            error: null,
          };
        },
      };
      return api;
    },
    get stripeCustomerId() {
      return stripeCustomerId;
    },
    set stripeCustomerId(value: string | null) {
      stripeCustomerId = value;
    },
  };
}

test.describe('STYL-142 Stripe customer reuse per tenant', () => {
  test('two subscription checkouts call customers.create at most once', async () => {
    const stripe = createMockStripe();
    const supabase = createTenantSupabase();

    const first = await ensureTenantStripeCustomerForSubscription(
      stripe as never,
      supabase as never,
      { tenantId: TENANT_ID, email: 'owner@example.com' },
      { STRIPE_INVOICE_PRESENTATION_ENABLED: 'false' } as NodeJS.ProcessEnv,
    );
    const second = await ensureTenantStripeCustomerForSubscription(
      stripe as never,
      supabase as never,
      { tenantId: TENANT_ID, stripeCustomerId: supabase.stripeCustomerId, email: 'owner@example.com' },
      { STRIPE_INVOICE_PRESENTATION_ENABLED: 'false' } as NodeJS.ProcessEnv,
    );

    expect(first).toBe('cus_created_142');
    expect(second).toBe('cus_created_142');
    expect(stripe.createCount).toBe(1);
    expect(supabase.stripeCustomerId).toBe('cus_created_142');
  });

  test('existing stripe_customer_id is reused without create', async () => {
    const stripe = createMockStripe();
    const supabase = createTenantSupabase();
    supabase.stripeCustomerId = 'cus_existing_142';

    const id = await ensureTenantStripeCustomerForSubscription(
      stripe as never,
      supabase as never,
      { tenantId: TENANT_ID, stripeCustomerId: 'cus_existing_142', email: 'owner@example.com' },
      { STRIPE_INVOICE_PRESENTATION_ENABLED: 'false' } as NodeJS.ProcessEnv,
    );

    expect(id).toBe('cus_existing_142');
    expect(stripe.createCount).toBe(0);
  });
});
