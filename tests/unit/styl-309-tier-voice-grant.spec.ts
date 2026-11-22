import { test, expect } from '@playwright/test';
import { handleStripeBillingEvent, loadTierIncludedVoiceMinutes } from '../../src/lib/billing/process-stripe-webhook';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';

test.describe('STYL-309: checkout voice grant from tier_entitlements', () => {
  test('loadTierIncludedVoiceMinutes walks tier aliases and returns the first positive limit', async () => {
    const db = {
      from(table: string) {
        if (table !== 'tier_entitlements') throw new Error(`unexpected table ${table}`);
        const api: {
          tierId: string;
          select: () => typeof api;
          eq: (col: string, value: string) => typeof api;
          maybeSingle: () => Promise<{ data: { limit_value: number | null } | null; error: null }>;
        } = {
          tierId: '',
          select() {
            return api;
          },
          eq(col, value) {
            if (col === 'tier_id') api.tierId = value;
            return api;
          },
          async maybeSingle() {
            if (api.tierId === 'premium') {
              return { data: { limit_value: 0 }, error: null };
            }
            if (api.tierId === 'foundation') {
              return { data: { limit_value: 25 }, error: null };
            }
            return { data: null, error: null };
          },
        };
        return api;
      },
    };

    await expect(loadTierIncludedVoiceMinutes(db, 'premium')).resolves.toBe(25);
  });

  test('base-plan checkout allocates voice minutes from tier_entitlements, not a hard-coded value', async () => {
    const allocations: Array<[string, string, number]> = [];
    const db = {
      entitlements: { ultimate: 0, foundation: 18 },
      state: {
        tenants: [{
          id: TENANT_ID,
          plan_tier: 'trial',
          is_active: false,
          subscription_status: 'incomplete',
          stripe_customer_id: null as string | null,
        }],
      },
      from(table: string) {
        const self = this as typeof db;
        const filters: Array<[string, string]> = [];
        let pendingUpdate: Record<string, unknown> | null = null;
        const api: Record<string, unknown> = {
          select() {
            return api;
          },
          eq(col: string, val: string) {
            filters.push([col, val]);
            return api;
          },
          is(col: string, val: null) {
            if (col === 'stripe_customer_id' && val === null && self.state.tenants[0].stripe_customer_id) {
              filters.push(['__skip_update', '1']);
            }
            return api;
          },
          maybeSingle: async () => {
            if (table === 'tier_entitlements') {
              const tier = filters.find(([c]) => c === 'tier_id')?.[1] ?? '';
              const limit = self.entitlements[tier as keyof typeof self.entitlements];
              return limit == null
                ? { data: null, error: null }
                : { data: { limit_value: limit }, error: null };
            }
            if (table === 'tenants' && pendingUpdate) {
              if (!filters.some(([c]) => c === '__skip_update')) {
                Object.assign(self.state.tenants[0], pendingUpdate);
              }
              pendingUpdate = null;
            }
            return { data: null, error: null };
          },
          update(payload: Record<string, unknown>) {
            pendingUpdate = payload;
            return api;
          },
          then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
            Promise.resolve()
              .then(async () => {
                if (table === 'tenants' && pendingUpdate) {
                  if (!filters.some(([c]) => c === '__skip_update')) {
                    Object.assign(self.state.tenants[0], pendingUpdate);
                  }
                  pendingUpdate = null;
                  return { error: null };
                }
                return { error: null };
              })
              .then(resolve, reject);
          },
        };
        return api;
      },
    };

    const result = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_styl309_entitlements',
            customer: 'cus_styl309',
            metadata: { tenant_id: TENANT_ID, plan_tier: 'ultimate' },
          },
        },
      },
      {
        supabaseAdmin: db,
        allocateRollingCredits: async (tenantId, featureId, quantity) => {
          allocations.push([tenantId, featureId, quantity]);
        },
      },
    );

    expect(result.status).toBe(200);
    expect(allocations).toEqual([[TENANT_ID, 'voice_minutes', 18]]);
  });
});