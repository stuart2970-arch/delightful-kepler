import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deactivateAddonsForCancelledSubscription,
  handleStripeBillingEvent,
  processAddonLineItems,
  syncAddonStatusAfterInvoice,
} from '../src/lib/billing/process-stripe-webhook';
import { tenantHasPaidPhoneAddon } from '../src/lib/telephony/provision-safety';
import { stripeStatusToAddonStatus } from '../src/lib/billing/addon-subscription-status';

const TENANT = '10000000-0000-0000-0000-000000000002';
const root = process.cwd();

type Row = Record<string, any>;

function createStripeStore(addons: Row[] = []) {
  const catalog: Row[] = [{
    id: 'landline_addon',
    category: 'landline',
    stripe_price_id: 'price_landline',
    monthly_price_pence: 899,
    included_voice_minutes: 0,
    included_sms: 0,
    included_messages: 0,
    included_data_chunks: 0,
    is_active: true,
  }];
  const tables: Record<string, Row[]> = {
    addon_catalog: catalog,
    tenant_active_addons: addons,
    addon_audit_log: [],
  };

  function from(name: string) {
    const filters: Array<[string, string, any]> = [];
    const rowMatches = (row: Row) => filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      if (op === 'neq') return row[col] != null && row[col] !== val;
      if (op === 'lt') return row[col] < val;
      if (op === 'is') return val === null ? row[col] == null : row[col] === val;
      if (op === 'or') {
        return String(val).split(',').some((part) => {
          const [column, pred, rhs] = part.split('.');
          if (pred === 'is' && rhs === 'null') return row[column] == null;
          if (pred === 'neq') return row[column] != null && row[column] !== rhs;
          return false;
        });
      }
      return true;
    });
    const matched = () => (tables[name] || []).filter(rowMatches);
    const api: any = {
      select() { return api; },
      eq(column: string, value: string) {
        filters.push(['eq', column, value]);
        return api;
      },
      neq(column: string, value: string) {
        filters.push(['neq', column, value]);
        return api;
      },
      lt(column: string, value: string) {
        filters.push(['lt', column, value]);
        return api;
      },
      is(column: string, value: any) {
        filters.push(['is', column, value]);
        return api;
      },
      in(column: string, values: string[]) {
        filters.push(['in', column, values]);
        return api;
      },
      or(expr: string) {
        filters.push(['or', '', expr]);
        return api;
      },
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
      },
      async maybeSingle() {
        return { data: matched()[0] || null, error: null };
      },
      async insert(row: Row) {
        (tables[name] || (tables[name] = [])).push({ id: `${name}-${tables[name].length + 1}`, ...row });
        return { error: null };
      },
      update(row: Row) {
        const apply = async () => {
          for (const item of matched()) Object.assign(item, row);
          return { error: null };
        };
        const chain: any = {
          eq(column: string, value: string) {
            filters.push(['eq', column, value]);
            return chain;
          },
          neq(column: string, value: string) {
            filters.push(['neq', column, value]);
            return chain;
          },
          lt(column: string, value: string) {
            filters.push(['lt', column, value]);
            return chain;
          },
          is(column: string, value: any) {
            filters.push(['is', column, value]);
            return chain;
          },
          in(column: string, values: string[]) {
            filters.push(['in', column, values]);
            return chain;
          },
          or(expr: string) {
            filters.push(['or', '', expr]);
            return chain;
          },
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            return apply().then(resolve, reject);
          },
        };
        return chain;
      },
    };
    return api;
  }

  return {
    from,
    rpc: async () => ({ error: null }),
    addons,
  };
}

test.describe('STYL-226: Stripe writes addon subscription_status', () => {
  test('maps Stripe statuses and does not copy tenants.subscription_status in the backfill', () => {
    expect(stripeStatusToAddonStatus('trialing')).toBe('trialing');
    expect(stripeStatusToAddonStatus('canceled')).toBe('cancelled');
    expect(stripeStatusToAddonStatus('unpaid')).toBe('past_due');
    const sql = readFileSync(join(root, 'supabase/migrations/20261102120000_styl226_phone_purchase_reservation.sql'), 'utf8');
    expect(sql).not.toMatch(/UPDATE public\.tenant_active_addons[\s\S]*FROM public\.tenants/);
    expect(sql).not.toMatch(/SET subscription_status = CASE/);
    expect(sql).toContain('Do not copy tenants.subscription_status');
    expect(sql).toContain('stripe_subscription_id');
    expect(sql).toContain("'unknown'");
    const route = readFileSync(join(root, 'src/app/api/webhooks/stripe/route.ts'), 'utf8');
    expect(route).not.toContain('export async function processAddonLineItems');
    expect(route).not.toContain('export async function syncAddonStatusAfterInvoice');
    expect(route).toContain('handleStripeBillingEvent');
    const lib = readFileSync(join(root, 'src/lib/billing/process-stripe-webhook.ts'), 'utf8');
    expect(lib).toContain('addonActivateStatusFields');
    expect(lib).toContain('syncAddonStatusAfterInvoice');
    expect(lib).toContain('stripe_subscription_id');
  });

  test('activate insert and update persist Stripe subscription_status and subscription id', async () => {
    const store = createStripeStore();
    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      subscription: 'sub_landline',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'activate', async () => undefined, { stripeSubscriptionStatus: 'trialing', stripeSubscriptionId: 'sub_landline' });
    expect(store.addons[0].subscription_status).toBe('trialing');
    expect(store.addons[0].stripe_subscription_id).toBe('sub_landline');
    expect(store.addons[0].is_active).toBe(true);

    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      subscription: 'sub_landline',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'activate', async () => undefined, { stripeSubscriptionStatus: 'active', stripeSubscriptionId: 'sub_landline' });
    expect(store.addons[0].subscription_status).toBe('active');
  });

  test('deactivate and cancelled subscription write cancelled', async () => {
    const store = createStripeStore([{
      id: 'row-1',
      tenant_id: TENANT,
      addon_catalog_id: 'landline_addon',
      is_active: true,
      subscription_status: 'active',
      stripe_subscription_id: 'sub_landline',
    }]);
    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'deactivate', async () => undefined);
    expect(store.addons[0].is_active).toBe(false);
    expect(store.addons[0].subscription_status).toBe('cancelled');

    store.addons[0].is_active = true;
    store.addons[0].subscription_status = 'active';
    await deactivateAddonsForCancelledSubscription(store, {
      tenantId: TENANT,
      addonCatalogId: 'landline_addon',
    });
    expect(store.addons[0].subscription_status).toBe('cancelled');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(false);
  });

  test('invoice status updates only the matching bolt-on subscription', async () => {
    const store = createStripeStore([
      {
        id: 'row-landline',
        tenant_id: TENANT,
        addon_catalog_id: 'landline_addon',
        is_active: true,
        subscription_status: 'active',
        stripe_subscription_id: 'sub_landline',
      },
      {
        id: 'row-mobile',
        tenant_id: TENANT,
        addon_catalog_id: 'mobile_addon',
        is_active: true,
        subscription_status: 'active',
        stripe_subscription_id: 'sub_mobile',
      },
      {
        id: 'row-old',
        tenant_id: TENANT,
        addon_catalog_id: 'google_calendar_addon',
        is_active: false,
        subscription_status: 'cancelled',
        stripe_subscription_id: 'sub_landline',
      },
    ]);

    await handleStripeBillingEvent({
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_landline',
          metadata: { tenant_id: TENANT, is_addon: 'true', addon_catalog_id: 'landline_addon' },
        },
      },
    }, { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    expect(store.addons[0].subscription_status).toBe('past_due');
    expect(store.addons[1].subscription_status).toBe('active');
    expect(store.addons[2].subscription_status).toBe('cancelled');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(true);

    await syncAddonStatusAfterInvoice(store, { stripeSubscriptionId: 'sub_landline', outcome: 'succeeded' });
    expect(store.addons[0].subscription_status).toBe('active');
    expect(store.addons[1].subscription_status).toBe('active');
    expect(store.addons[2].is_active).toBe(false);
  });

  test('invoice success fills a NULL subscription id without waiting for the next renewal', async () => {
    const store = createStripeStore([{
      id: 'row-null',
      tenant_id: TENANT,
      addon_catalog_id: 'landline_addon',
      is_active: true,
      subscription_status: null,
      stripe_subscription_id: null,
      price_paid_pence: 899,
    }]);
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(true);

    await handleStripeBillingEvent({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          subscription: 'sub_landline',
          metadata: { tenant_id: TENANT, is_addon: 'true', addon_catalog_id: 'landline_addon' },
          lines: { data: [{ price: { id: 'price_landline' } }] },
        },
      },
    }, { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    expect(store.addons[0].subscription_status).toBe('active');
    expect(store.addons[0].stripe_subscription_id).toBe('sub_landline');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(true);
  });
});
