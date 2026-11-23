import { test, expect } from '@playwright/test';
import { ensureTenantStripeCustomerForSubscription } from '../src/lib/billing/stripe-tenant-customer';

const TENANT_A = '41400000-0000-4000-8000-000000000001';
const TENANT_B = '41400000-0000-4000-8000-000000000002';
const SHARED_EMAIL = 'same-owner@example.com';
const UNTAGGED_CUSTOMER_ID = 'cus_untagged_shared';

type TenantRow = { id: string; stripe_customer_id: string | null };

/**
 * Two tenant rows. A link sticks only while stripe_customer_id is still null.
 */
function createTwoTenantSupabase() {
  const rows: TenantRow[] = [
    { id: TENANT_A, stripe_customer_id: null },
    { id: TENANT_B, stripe_customer_id: null },
  ];

  return {
    from(table: string) {
      if (table !== 'tenants') throw new Error(`unexpected table ${table}`);
      const filters: Array<{ op: 'eq' | 'neq' | 'is'; col: string; val: unknown }> = [];
      let pendingUpdate: Record<string, unknown> | null = null;

      const matches = (row: TenantRow) =>
        filters.every((filter) => {
          const current = row[filter.col as keyof TenantRow];
          if (filter.op === 'neq') return current !== filter.val;
          return current === filter.val;
        });

      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: 'eq', col, val });
          return api;
        },
        neq(col: string, val: unknown) {
          filters.push({ op: 'neq', col, val });
          return api;
        },
        is(col: string, val: unknown) {
          filters.push({ op: 'is', col, val });
          return api;
        },
        limit() {
          return api;
        },
        update(payload: Record<string, unknown>) {
          pendingUpdate = payload;
          return api;
        },
        async maybeSingle() {
          if (pendingUpdate) {
            const payload = pendingUpdate;
            pendingUpdate = null;
            const target = rows.find(matches);
            const nullOnly = filters.some(
              (filter) => filter.op === 'is' && filter.col === 'stripe_customer_id' && filter.val === null,
            );
            if (target && nullOnly && target.stripe_customer_id === null) {
              target.stripe_customer_id = String(payload.stripe_customer_id);
              return { data: { stripe_customer_id: target.stripe_customer_id }, error: null };
            }
            return { data: null, error: null };
          }
          return { data: rows.find(matches) ?? null, error: null };
        },
      };
      return api;
    },
    rows,
  };
}

test.describe('STYL-414 same-email tenant checkout race', () => {
  test('two tenants checking out together do not share an untagged Stripe customer', async () => {
    const shared = {
      id: UNTAGGED_CUSTOMER_ID,
      email: SHARED_EMAIL,
      metadata: {} as Record<string, string>,
    };
    let listCalls = 0;
    let releaseBothLists: () => void = () => {};
    const bothListed = new Promise<void>((resolve) => {
      releaseBothLists = resolve;
    });
    const createdIds: string[] = [];

    const stripe = {
      customers: {
        async search() {
          return { data: [] as Array<{ id: string }> };
        },
        async list() {
          listCalls += 1;
          if (listCalls >= 2) releaseBothLists();
          await bothListed;
          return {
            data: [{ id: shared.id, email: shared.email, metadata: { ...shared.metadata } }],
          };
        },
        async update(_id: string, params: { metadata?: Record<string, string> }) {
          if (params.metadata?.tenant_id) {
            shared.metadata = { ...shared.metadata, ...params.metadata };
          }
          return { id: shared.id, email: shared.email, metadata: { ...shared.metadata } };
        },
        async create(
          params: { email?: string; metadata?: Record<string, string> },
          options?: { idempotencyKey?: string },
        ) {
          const tenantId = params.metadata?.tenant_id || '';
          expect(options?.idempotencyKey).toBe(`cust-${tenantId}`);
          expect(params.metadata?.tenant_id).toBe(tenantId);
          const id = `cus_created_${tenantId}`;
          createdIds.push(id);
          return { id, email: params.email, metadata: params.metadata || {} };
        },
      },
    };

    const supabase = createTwoTenantSupabase();
    const env = { STRIPE_INVOICE_PRESENTATION_ENABLED: 'false' } as NodeJS.ProcessEnv;

    const [idA, idB] = await Promise.all([
      ensureTenantStripeCustomerForSubscription(
        stripe as never,
        supabase as never,
        { tenantId: TENANT_A, email: SHARED_EMAIL },
        env,
      ),
      ensureTenantStripeCustomerForSubscription(
        stripe as never,
        supabase as never,
        { tenantId: TENANT_B, email: SHARED_EMAIL },
        env,
      ),
    ]);

    expect(idA).toBe(`cus_created_${TENANT_A}`);
    expect(idB).toBe(`cus_created_${TENANT_B}`);
    expect(idA).not.toBe(idB);
    expect(idA).not.toBe(UNTAGGED_CUSTOMER_ID);
    expect(idB).not.toBe(UNTAGGED_CUSTOMER_ID);
    expect(createdIds).toHaveLength(2);
    expect(supabase.rows.map((row) => row.stripe_customer_id).sort()).toEqual(
      [`cus_created_${TENANT_A}`, `cus_created_${TENANT_B}`].sort(),
    );
  });
});
