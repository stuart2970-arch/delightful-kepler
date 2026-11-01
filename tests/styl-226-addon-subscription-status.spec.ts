import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  processAddonLineItems,
  syncAddonStatusAfterInvoice,
  deactivateAddonsForCancelledSubscription,
} from '../src/app/api/webhooks/stripe/route';
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
  }];
  const tables: Record<string, Row[]> = {
    addon_catalog: catalog,
    tenant_active_addons: addons,
    addon_audit_log: [],
  };

  function from(name: string) {
    const filters: Array<[string, string, any]> = [];
    const matched = () => (tables[name] || []).filter((row) => filters.every(([op, col, val]) => (
      op === 'eq' ? row[col] === val : true
    )));
    const api: any = {
      select() { return api; },
      eq(column: string, value: string) {
        filters.push(['eq', column, value]);
        return api;
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
  test('maps Stripe statuses and does not blanket-backfill active', () => {
    expect(stripeStatusToAddonStatus('trialing')).toBe('trialing');
    expect(stripeStatusToAddonStatus('canceled')).toBe('cancelled');
    expect(stripeStatusToAddonStatus('unpaid')).toBe('past_due');
    const sql = readFileSync(join(root, 'supabase/migrations/20261101120000_styl226_phone_purchase_reservation.sql'), 'utf8');
    expect(sql).not.toMatch(/SET subscription_status = 'active'\s+WHERE is_active IS TRUE/);
    expect(sql).toContain('tenants AS t');
    const stripe = readFileSync(join(root, 'src/app/api/webhooks/stripe/route.ts'), 'utf8');
    expect(stripe).toContain('addonActivateStatusFields');
    expect(stripe).toContain('syncAddonStatusAfterInvoice');
    expect(stripe).toContain('deactivateAddonsForCancelledSubscription');
  });

  test('activate insert and update persist Stripe subscription_status', async () => {
    const store = createStripeStore();
    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'activate', 'trialing');
    expect(store.addons[0].subscription_status).toBe('trialing');
    expect(store.addons[0].is_active).toBe(true);

    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'activate', 'active');
    expect(store.addons[0].subscription_status).toBe('active');
  });

  test('deactivate and cancelled subscription write cancelled', async () => {
    const store = createStripeStore([{
      id: 'row-1',
      tenant_id: TENANT,
      addon_catalog_id: 'landline_addon',
      is_active: true,
      subscription_status: 'active',
    }]);
    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'deactivate');
    expect(store.addons[0].is_active).toBe(false);
    expect(store.addons[0].subscription_status).toBe('cancelled');

    store.addons[0].is_active = true;
    store.addons[0].subscription_status = 'active';
    await deactivateAddonsForCancelledSubscription(store, TENANT, 'landline_addon');
    expect(store.addons[0].subscription_status).toBe('cancelled');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(false);
  });

  test('a payment that fails after activation is no longer paid-gate eligible', async () => {
    const store = createStripeStore();
    await processAddonLineItems(store, TENANT, [{
      id: 'si_1',
      price: { id: 'price_landline', unit_amount: 899 },
    }], 'activate', 'active');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(true);

    await syncAddonStatusAfterInvoice(store, TENANT, 'failed');
    expect(store.addons[0].subscription_status).toBe('past_due');
    expect(tenantHasPaidPhoneAddon(store.addons)).toBe(false);
  });
});
