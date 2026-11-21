import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  handleStripeBillingEvent,
  syncBoltOnPendingCancellation,
} from '../src/lib/billing/process-stripe-webhook';
import { createActivateTenantAddon } from './helpers/activate-tenant-addon-fake';
import {
  pendingCancelPairFromStripe,
  stripeSubscriptionPeriodEndUnix,
} from '../src/lib/billing/addon-subscription-status';
import {
  buildAccountOwnership,
  formatBoltOnCancelLabel,
  type CatalogAddon,
} from '../src/lib/billing/account-ownership';

/**
 * STYL-261: webhook cancel race, out-of-order events, and set-date cancel_at.
 * Mocked Stripe payloads only.
 */

const TENANT = '10000000-0000-0000-0000-000000000099';
const CATALOG = 'google_calendar_addon';
const SUBSCRIPTION = 'sub_styl261';
const CANCEL_AT = '2026-12-09T21:41:13.000Z';
const CANCEL_UNIX = Date.parse(CANCEL_AT) / 1000;
const root = process.cwd();

type Row = Record<string, any>;

function createStore(addons: Row[] = []) {
  const tables: Record<string, Row[]> = {
    addon_catalog: [{
      id: CATALOG,
      category: 'google_calendar',
      stripe_price_id: 'price_google',
      monthly_price_pence: 499,
      included_voice_minutes: 0,
      included_sms: 0,
      included_messages: 0,
      included_data_chunks: 0,
      is_active: true,
    }],
    tenant_active_addons: addons,
    addon_audit_log: [],
    tenants: [{ id: TENANT, plan_tier: 'foundation', is_active: true }],
  };
  const activateTenantAddon = createActivateTenantAddon(tables.tenant_active_addons);

  function from(name: string) {
    const filters: Array<[string, string, any]> = [];
    let pendingInsert: Row | null = null;
    const rowMatches = (row: Row) => filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      if (op === 'neq') return row[col] != null && row[col] !== val;
      if (op === 'is') return val === null ? row[col] == null : row[col] === val;
      if (op === 'or') {
        return String(val).split(',').some((part) => {
          const [column, pred, rhs] = part.split('.');
          if (pred === 'is' && rhs === 'null') return row[column] == null;
          if (pred === 'neq') return row[column] != null && String(row[column]) !== rhs;
          return false;
        });
      }
      return true;
    });
    const matched = () => (tables[name] || []).filter(rowMatches);
    const api: any = {
      select() { return api; },
      eq(column: string, value: any) {
        filters.push(['eq', column, value]);
        return api;
      },
      in(column: string, values: any[]) {
        filters.push(['in', column, values]);
        return api;
      },
      neq(column: string, value: any) {
        filters.push(['neq', column, value]);
        return api;
      },
      is(column: string, value: any) {
        filters.push(['is', column, value]);
        return api;
      },
      or(expr: string) {
        filters.push(['or', '', expr]);
        return api;
      },
      order() { return api; },
      limit() { return api; },
      insert(row: Row) {
        pendingInsert = row;
        return api;
      },
      update(row: Row) {
        const chain: any = {
          eq(column: string, value: any) {
            filters.push(['eq', column, value]);
            return chain;
          },
          is(column: string, value: any) {
            filters.push(['is', column, value]);
            return chain;
          },
          select() {
            return chain;
          },
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            const hits = matched();
            for (const item of hits) Object.assign(item, row);
            return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
          },
        };
        return chain;
      },
      async maybeSingle() {
        return { data: matched()[0] || null, error: null };
      },
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        const result = Promise.resolve().then(() => {
          if (!pendingInsert) return { data: matched(), error: null };
          const row = pendingInsert;
          (tables[name] || (tables[name] = [])).push({
            id: `${name}-${(tables[name] || []).length + 1}`,
            ...row,
          });
          return { data: null, error: null };
        });
        return result.then(resolve, reject);
      },
    };
    return api;
  }

  return {
    from,
    rpc: async (name: string, args: any) => {
      if (name === 'activate_tenant_addon') {
        return { data: await activateTenantAddon(args), error: null };
      }
      return { data: null, error: null };
    },
    addons: tables.tenant_active_addons,
    audit: tables.addon_audit_log,
  };
}

function activeRow(): Row {
  return {
    id: 'active-row',
    tenant_id: TENANT,
    addon_catalog_id: CATALOG,
    is_active: true,
    subscription_status: 'active',
    stripe_subscription_id: SUBSCRIPTION,
    stripe_subscription_item_id: 'si_test_1',
    price_paid_pence: 499,
    created_at: '2026-11-09T16:18:05.664Z',
    cancel_at_period_end: null,
    cancel_at: null,
  };
}

function subscriptionObject(overrides: Record<string, any> = {}) {
  return {
    id: SUBSCRIPTION,
    status: 'active',
    metadata: {
      tenant_id: TENANT,
      addon_catalog_id: CATALOG,
      is_addon: 'true',
    },
    items: { data: [{ id: 'si_test_1', price: { unit_amount: 499 } }] },
    ...overrides,
  };
}

const OWNERSHIP_CATALOG: CatalogAddon[] = [{
  id: CATALOG,
  name: 'Google Calendar Integration',
  category: 'google_calendar',
  monthly_price_pence: 499,
  is_active: true,
  display_order: 1,
}];

test.describe('STYL-261 pending cancel helpers', () => {
  test('set-date cancel_at counts as pending even when cancel_at_period_end is false', () => {
    const pair = pendingCancelPairFromStripe({
      cancel_at_period_end: false,
      cancel_at: CANCEL_UNIX,
    });
    expect(pair.cancel_at_period_end).toBe(true);
    expect(Date.parse(pair.cancel_at!)).toBe(Date.parse(CANCEL_AT));

    const owned = buildAccountOwnership({
      plan: { name: 'Foundation', price_pence: 999 },
      catalog: OWNERSHIP_CATALOG,
      purchases: [{
        addon_catalog_id: CATALOG,
        is_active: true,
        price_paid_pence: 499,
        cancel_at_period_end: pair.cancel_at_period_end,
        cancel_at: pair.cancel_at,
      }],
      inclusions: [],
    });
    expect(owned.monthly_bolt_ons.find((item) => item.id === CATALOG)?.cancel_at_period_end).toBe(true);
    expect(formatBoltOnCancelLabel(owned.monthly_bolt_ons[0]?.cancel_at)).toBe('Cancels 9 Dec 2026');
  });

  test('period end reads current_period_end from subscription items', () => {
    const fromItems = stripeSubscriptionPeriodEndUnix({
      items: { data: [{ current_period_end: CANCEL_UNIX }] },
    });
    expect(fromItems).toBe(CANCEL_UNIX);

    const pair = pendingCancelPairFromStripe({
      cancel_at_period_end: true,
      cancel_at: null,
      items: { data: [{ current_period_end: CANCEL_UNIX }] },
    });
    expect(pair.cancel_at_period_end).toBe(true);
    expect(Date.parse(pair.cancel_at!)).toBe(Date.parse(CANCEL_AT));
  });
});

test.describe('STYL-261 webhook cancel guard', () => {
  test('migration adds stripe_cancel_event_created_at only', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261121180200_styl261_stripe_cancel_event_guard.sql'),
      'utf8',
    );
    expect(sql).toContain('stripe_cancel_event_created_at');
    expect(sql.toLowerCase()).toContain('drop column if exists stripe_cancel_event_created_at');
    expect(sql.toLowerCase()).not.toContain('delete from');
  });

  test('overlapping deliveries keep a single addon_cancel_scheduled audit row', async () => {
    const store = createStore([activeRow()]);
    const scheduled = {
      cancel_at_period_end: true,
      cancel_at: CANCEL_UNIX,
    };
    const payload = {
      ...scheduled,
      id: SUBSCRIPTION,
      status: 'active',
      metadata: subscriptionObject().metadata,
      items: subscriptionObject().items,
    };

    await Promise.all([
      syncBoltOnPendingCancellation(store, payload, { eventCreatedAt: 1_800_000_100 }),
      syncBoltOnPendingCancellation(store, payload, { eventCreatedAt: 1_800_000_101 }),
    ]);

    expect(store.addons[0].cancel_at_period_end).toBe(true);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
  });

  test('an older Stripe event does not overwrite a newer cancel state', async () => {
    const store = createStore([{
      ...activeRow(),
      cancel_at_period_end: true,
      cancel_at: CANCEL_AT,
      stripe_cancel_event_created_at: new Date(1_800_000_200 * 1000).toISOString(),
    }]);

    const cleared = subscriptionObject({
      cancel_at_period_end: false,
      cancel_at: null,
    });
    const olderCleared = await syncBoltOnPendingCancellation(store, cleared, {
      eventCreatedAt: 1_800_000_100,
    });
    expect(olderCleared).toEqual({ ok: true });
    expect(store.addons[0].cancel_at_period_end).toBe(true);
    expect(store.audit).toHaveLength(0);

    const newerCleared = await syncBoltOnPendingCancellation(store, cleared, {
      eventCreatedAt: 1_800_000_300,
    });
    expect(newerCleared).toEqual({ ok: true });
    expect(store.addons[0].cancel_at_period_end).toBe(false);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_unscheduled')).toHaveLength(1);
  });

  test('customer.subscription.updated end-to-end honours item period end for set-date cancel', async () => {
    const store = createStore([activeRow()]);
    const result = await handleStripeBillingEvent({
      type: 'customer.subscription.updated',
      created: 1_800_000_500,
      data: {
        object: subscriptionObject({
          cancel_at_period_end: false,
          cancel_at: CANCEL_UNIX,
        }),
      },
    }, {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(result.status).toBe(200);
    expect(store.addons[0].cancel_at_period_end).toBe(true);
    expect(Date.parse(store.addons[0].cancel_at)).toBe(Date.parse(CANCEL_AT));
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
  });
});