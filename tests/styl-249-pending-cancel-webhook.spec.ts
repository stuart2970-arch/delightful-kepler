import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleStripeBillingEvent } from '../src/lib/billing/process-stripe-webhook';
import { createActivateTenantAddon } from './helpers/activate-tenant-addon-fake';
import {
  buildAccountOwnership,
  formatBoltOnCancelLabel,
  type CatalogAddon,
} from '../src/lib/billing/account-ownership';

/**
 * STYL-249: a period-end cancel stays entitled and shows Cancels [date].
 * In-memory Stripe events only. No live Stripe.
 */

const TENANT = '10000000-0000-0000-0000-000000000002';
const CATALOG = 'google_calendar_addon';
const SUBSCRIPTION = 'sub_test_calendar';
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
          in(column: string, values: any[]) {
            filters.push(['in', column, values]);
            return chain;
          },
          neq(column: string, value: any) {
            filters.push(['neq', column, value]);
            return chain;
          },
          is(column: string, value: any) {
            filters.push(['is', column, value]);
            return chain;
          },
          or(expr: string) {
            filters.push(['or', '', expr]);
            return chain;
          },
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            for (const item of matched()) Object.assign(item, row);
            return Promise.resolve({ data: matched(), error: null }).then(resolve, reject);
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
    addons,
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
  };
}

function subscriptionUpdated(overrides: Record<string, any> = {}) {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: SUBSCRIPTION,
        status: 'active',
        metadata: {
          tenant_id: TENANT,
          addon_catalog_id: CATALOG,
          is_addon: 'true',
        },
        items: { data: [{ id: 'si_test_1', price: { unit_amount: 499 } }] },
        ...overrides,
      },
    },
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

test.describe('STYL-249 pending bolt-on cancellation', () => {
  test('migration is additive and does not depend on the duplicate-delete file', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261111084313_styl249_250_pending_cancel_and_audit_rls.sql'),
      'utf8',
    );
    expect(sql).toContain('cancel_at_period_end');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS cancel_at timestamptz');
    expect(sql).toContain('addon_cancel_scheduled');
    expect(sql).toContain('addon_cancel_unscheduled');
    expect(sql).toContain('select_own_addon_audit_log');
    expect(sql).toContain('select_superadmin_addon_audit_log');
    expect(sql.toLowerCase()).toContain('does not depend on 20261024130000');
    expect(sql).toContain("to_regclass('public.knowledge_sources')");
    expect(sql).toContain("to_regclass('public.referral_clicks')");
    expect(sql.toLowerCase()).not.toContain('delete from');
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]{0,80}knowledge_sources/i);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]{0,80}referral_clicks/i);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
    expect(sql).not.toMatch(/activate_tenant_addon/);
    expect(sql).not.toMatch(/document_chunks_styl189_backup_20261105/);
  });

  test('subscription.updated stores a pending cancel and a retry does not audit twice', async () => {
    const store = createStore([activeRow()]);
    const event = subscriptionUpdated({
      cancel_at_period_end: true,
      cancel_at: CANCEL_UNIX,
    });

    const first = await handleStripeBillingEvent(event, {
      supabaseAdmin: store,
      allocateRollingCredits: async () => {
        throw new Error('credits must not be allocated again');
      },
    });
    expect(first.status).toBe(200);

    const active = store.addons.filter((row) => row.is_active === true);
    expect(active).toHaveLength(1);
    expect(active[0].is_active).toBe(true);
    expect(active[0].cancel_at_period_end).toBe(true);
    expect(Date.parse(active[0].cancel_at)).toBe(Date.parse(CANCEL_AT));
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(0);
    expect(store.audit.filter((row) => row.action === 'addon_deactivated')).toHaveLength(0);
    expect(store.audit[0].new_value.cancel_at_period_end).toBe(true);
    expect(store.audit[0].new_value.stripe_subscription_id).toBe(SUBSCRIPTION);
    expect(store.audit[0].summary).toContain(CATALOG);

    const second = await handleStripeBillingEvent(event, {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(second.status).toBe(200);
    expect(store.addons.filter((row) => row.is_active === true)).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
  });

  test('a missing cancel_at falls back to current_period_end', async () => {
    const store = createStore([activeRow()]);
    const result = await handleStripeBillingEvent(subscriptionUpdated({
      cancel_at_period_end: true,
      cancel_at: null,
      current_period_end: CANCEL_UNIX,
    }), {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(result.status).toBe(200);
    expect(store.addons[0].is_active).toBe(true);
    expect(store.addons[0].cancel_at_period_end).toBe(true);
    expect(Date.parse(store.addons[0].cancel_at)).toBe(Date.parse(CANCEL_AT));
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(0);
  });

  test('resuming the subscription clears the pending cancel once', async () => {
    const store = createStore([activeRow()]);
    await handleStripeBillingEvent(subscriptionUpdated({
      cancel_at_period_end: true,
      cancel_at: CANCEL_UNIX,
    }), { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    const resume = subscriptionUpdated({
      cancel_at_period_end: false,
      cancel_at: null,
    });
    const cleared = await handleStripeBillingEvent(resume, {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(cleared.status).toBe(200);
    expect(store.addons[0].is_active).toBe(true);
    expect(store.addons[0].cancel_at_period_end).toBe(false);
    expect(store.addons[0].cancel_at).toBeNull();
    expect(store.audit.filter((row) => row.action === 'addon_cancel_unscheduled')).toHaveLength(1);
    expect(store.audit.find((row) => row.action === 'addon_cancel_unscheduled')?.old_value.cancel_at_period_end).toBe(true);

    await handleStripeBillingEvent(resume, {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(store.audit.filter((row) => row.action === 'addon_cancel_unscheduled')).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(0);
  });

  test('subscription.deleted deactivates and clears the cancel columns', async () => {
    const store = createStore([{
      ...activeRow(),
      cancel_at_period_end: true,
      cancel_at: CANCEL_AT,
    }]);
    const result = await handleStripeBillingEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: SUBSCRIPTION,
          metadata: {
            tenant_id: TENANT,
            addon_catalog_id: CATALOG,
            is_addon: 'true',
          },
        },
      },
    }, { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    expect(result.status).toBe(200);
    expect(store.addons[0].is_active).toBe(false);
    expect(store.addons[0].subscription_status).toBe('cancelled');
    expect(store.addons[0].cancel_at_period_end).toBe(false);
    expect(store.addons[0].cancel_at).toBeNull();
    expect(store.audit.filter((row) => row.action === 'addon_deactivated')).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(0);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_unscheduled')).toHaveLength(0);
  });

  test('invoice.payment_succeeded does not wipe a pending cancel', async () => {
    const store = createStore([activeRow()]);
    await handleStripeBillingEvent(subscriptionUpdated({
      cancel_at_period_end: true,
      cancel_at: CANCEL_UNIX,
    }), { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    const result = await handleStripeBillingEvent({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          subscription: SUBSCRIPTION,
          metadata: {
            tenant_id: TENANT,
            addon_catalog_id: CATALOG,
            is_addon: 'true',
          },
        },
      },
    }, { supabaseAdmin: store, allocateRollingCredits: async () => undefined });

    expect(result.status).toBe(200);
    expect(store.addons[0].is_active).toBe(true);
    expect(store.addons[0].cancel_at_period_end).toBe(true);
    expect(Date.parse(store.addons[0].cancel_at)).toBe(Date.parse(CANCEL_AT));
    expect(store.audit.filter((row) => row.action === 'addon_cancel_scheduled')).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_cancel_unscheduled')).toHaveLength(0);
  });
});

test.describe('STYL-249 cancel label', () => {
  test('formats 9 Dec 2026 in Europe/London and keeps Already included', () => {
    expect(formatBoltOnCancelLabel('2026-12-09T21:41:13Z')).toBe('Cancels 9 Dec 2026');
    expect(formatBoltOnCancelLabel(CANCEL_AT)).toBe('Cancels 9 Dec 2026');
    expect(formatBoltOnCancelLabel(null)).toBeNull();
    expect(formatBoltOnCancelLabel(undefined)).toBeNull();
    expect(formatBoltOnCancelLabel('')).toBeNull();
    expect(formatBoltOnCancelLabel('not-a-date')).toBeNull();
    expect(formatBoltOnCancelLabel('2026-07-09T23:30:00Z')).toBe('Cancels 10 Jul 2026');

    const owned = buildAccountOwnership({
      plan: { name: 'Foundation', price_pence: 999 },
      catalog: OWNERSHIP_CATALOG,
      purchases: [{
        addon_catalog_id: CATALOG,
        is_active: true,
        price_paid_pence: 499,
        cancel_at_period_end: true,
        cancel_at: '2026-12-09T21:41:13Z',
      }],
      inclusions: [],
    });
    const google = owned.monthly_bolt_ons.find((item) => item.id === CATALOG);
    expect(google?.already_included).toBe(true);
    expect(google?.cancel_at_period_end).toBe(true);
    expect(formatBoltOnCancelLabel(google?.cancel_at)).toBe('Cancels 9 Dec 2026');
    expect(owned.active_bolt_ons[0]?.cancel_at_period_end).toBe(true);

    const quiet = buildAccountOwnership({
      plan: { name: 'Foundation', price_pence: 999 },
      catalog: OWNERSHIP_CATALOG,
      purchases: [{
        addon_catalog_id: CATALOG,
        is_active: true,
        price_paid_pence: 499,
      }],
      inclusions: [],
    });
    const stillIncluded = quiet.monthly_bolt_ons.find((item) => item.id === CATALOG);
    expect(stillIncluded?.already_included).toBe(true);
    expect(formatBoltOnCancelLabel(stillIncluded?.cancel_at)).toBeNull();
    expect(stillIncluded?.cancel_at_period_end).toBe(false);
  });
});
