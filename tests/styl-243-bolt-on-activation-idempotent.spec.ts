import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleStripeBillingEvent,
  processAddonLineItems,
} from '../src/lib/billing/process-stripe-webhook';
import { createActivateTenantAddon } from './helpers/activate-tenant-addon-fake';

/**
 * STYL-243: one Stripe purchase activates a bolt-on once.
 * Unit cases use the in-memory store. Integration cases use the local Supabase
 * CLI stack only — no live Stripe and no remote project.
 */

const TENANT = '10000000-0000-0000-0000-000000000002';
const CATALOG = 'google_calendar_addon';
const root = process.cwd();

type Row = Record<string, any>;

function createStore(options?: { addons?: Row[]; missingRpc?: boolean; voiceMinutes?: number }) {
  const addons: Row[] = [...(options?.addons || [])];
  const catalog: Row[] = [{
    id: CATALOG,
    category: 'google_calendar',
    stripe_price_id: 'price_google',
    monthly_price_pence: 499,
    included_voice_minutes: options?.voiceMinutes ?? 0,
    included_sms: 0,
    included_messages: 0,
    included_data_chunks: 0,
    is_active: true,
  }];
  const tables: Record<string, Row[]> = {
    addon_catalog: catalog,
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
          then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
            for (const item of matched()) Object.assign(item, row);
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return chain;
      },
      async maybeSingle() {
        const rows = matched();
        if (name === 'tenant_active_addons' && rows.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: rows[0] || null, error: null };
      },
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        const result = Promise.resolve().then(() => {
          if (!pendingInsert) return { data: matched(), error: null };
          const row = pendingInsert;
          if (name === 'tenant_active_addons') {
            const clash = (tables[name] || []).some((existing) => (
              existing.tenant_id === row.tenant_id
              && existing.addon_catalog_id === row.addon_catalog_id
              && existing.is_active === true
              && row.is_active !== false
            ));
            if (clash) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            (tables[name] || (tables[name] = [])).push({ id: `row-${tables[name].length + 1}`, created_at: new Date().toISOString(), ...row });
          } else {
            (tables[name] || (tables[name] = [])).push({ id: `${name}-${(tables[name] || []).length + 1}`, ...row });
          }
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
        if (options?.missingRpc) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.activate_tenant_addon' } };
        }
        return { data: await activateTenantAddon(args), error: null };
      }
      return { data: null, error: null };
    },
    addons,
    audit: tables.addon_audit_log,
  };
}

function checkoutEvent() {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_calendar',
        metadata: {
          tenant_id: TENANT,
          addon_catalog_id: CATALOG,
          is_addon: 'true',
        },
      },
    },
  };
}

function subscriptionEvent() {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test_calendar',
        status: 'active',
        metadata: {
          tenant_id: TENANT,
          addon_catalog_id: CATALOG,
          is_addon: 'true',
        },
        items: { data: [{ id: 'si_test_1', price: { unit_amount: 499 } }] },
      },
    },
  };
}

test.describe('STYL-243 bolt-on activation is idempotent', () => {
  test('migration refuses deletes, keeps the partial index, and service-role-only execute', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20261109171005_styl242_243_tenant_active_addons_rls_and_unique.sql'),
      'utf8',
    );
    expect(sql).toContain('tenant_active_addons_one_active_per_catalog');
    expect(sql).toContain('WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL');
    expect(sql).toContain('select_own_tenant_active_addons');
    expect(sql).toContain('select_superadmin_tenant_active_addons');
    expect(sql).toContain('select_tier_entitlements');
    expect(sql).toContain("app.styl243_dedupe");
    expect(sql).toContain('deactivate_newer');
    expect(sql).toContain('is_active = false');
    expect(sql).toContain('Never run 20261024130000 on live');
    expect(sql.toLowerCase()).not.toContain('delete from');
    expect(sql).not.toMatch(/\b(delete|update|insert|alter|drop|truncate)\b[\s\S]{0,120}document_chunks_styl189_backup_20261105/i);
    expect(sql).not.toMatch(/FOR\s+INSERT/i);
    expect(sql).not.toMatch(/FOR\s+DELETE/i);
    expect(sql).not.toMatch(/FOR\s+ALL/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.activate_tenant_addon');
    expect(sql).toContain('TO service_role');

    const oldUnique = readFileSync(
      join(root, 'supabase/migrations/20261024130000_styl202_addon_unique_and_helpers.sql'),
      'utf8',
    );
    expect(oldUnique).toContain('DELETE FROM public.tenant_active_addons');
  });

  test('concurrent checkout and subscription.updated leave one active row and one audit', async () => {
    const orders = [
      [checkoutEvent(), subscriptionEvent()],
      [subscriptionEvent(), checkoutEvent()],
    ];
    for (const events of orders) {
      const store = createStore({ voiceMinutes: 20 });
      const credits: string[] = [];
      await Promise.all(events.map((event) => handleStripeBillingEvent(event, {
        supabaseAdmin: store,
        allocateRollingCredits: async (_tenant, featureId) => {
          credits.push(featureId);
        },
      })));

      const active = store.addons.filter((row) => row.addon_catalog_id === CATALOG && row.is_active === true);
      expect(active).toHaveLength(1);
      expect(active[0].stripe_subscription_item_id).toBe('si_test_1');
      expect(active[0].stripe_subscription_id).toBe('sub_test_calendar');
      expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(1);
      expect(credits).toEqual(['voice_minutes']);
    }
  });

  test('an active plus inactive pair does not insert or audit again', async () => {
    const store = createStore({
      addons: [
        {
          id: 'active-row',
          tenant_id: TENANT,
          addon_catalog_id: CATALOG,
          is_active: true,
          created_at: '2026-11-09T16:18:05.664Z',
          stripe_subscription_item_id: 'si_test_1',
          stripe_subscription_id: 'sub_test_calendar',
        },
        {
          id: 'inactive-row',
          tenant_id: TENANT,
          addon_catalog_id: CATALOG,
          is_active: false,
          created_at: '2026-11-09T16:18:05.832Z',
          subscription_status: 'cancelled',
        },
      ],
    });

    const result = await handleStripeBillingEvent(subscriptionEvent(), {
      supabaseAdmin: store,
      allocateRollingCredits: async () => {
        throw new Error('credits must not be allocated again');
      },
    });

    expect(result.status).toBe(200);
    expect(store.addons.filter((row) => row.is_active === true)).toHaveLength(1);
    expect(store.addons).toHaveLength(2);
    expect(store.audit).toHaveLength(0);
  });

  test('an inactive row is reactivated once', async () => {
    const store = createStore({
      addons: [{
        id: 'inactive-only',
        tenant_id: TENANT,
        addon_catalog_id: CATALOG,
        is_active: false,
        subscription_status: 'cancelled',
        created_at: '2026-09-18T13:02:00.000Z',
      }],
    });

    const result = await handleStripeBillingEvent(subscriptionEvent(), {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });

    expect(result.status).toBe(200);
    expect(store.addons).toHaveLength(1);
    expect(store.addons[0].id).toBe('inactive-only');
    expect(store.addons[0].is_active).toBe(true);
    expect(store.addons[0].stripe_subscription_item_id).toBe('si_test_1');
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(1);
  });

  test('line-item activation writes one audit row when the event is delivered twice', async () => {
    const store = createStore();
    const line = [{
      id: 'si_line_1',
      subscription: 'sub_line',
      price: { id: 'price_google', unit_amount: 499 },
    }];
    await processAddonLineItems(store, TENANT, line, 'activate', async () => undefined, {
      stripeSubscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_line',
    });
    await processAddonLineItems(store, TENANT, line, 'activate', async () => undefined, {
      stripeSubscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_line',
    });
    expect(store.addons.filter((row) => row.is_active === true)).toHaveLength(1);
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(1);
  });

  test('a missing RPC falls back to a list read and treats a unique violation as already active', async () => {
    const store = createStore({ missingRpc: true });
    await handleStripeBillingEvent(subscriptionEvent(), {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    await handleStripeBillingEvent(checkoutEvent(), {
      supabaseAdmin: store,
      allocateRollingCredits: async () => undefined,
    });
    expect(store.addons.filter((row) => row.is_active === true)).toHaveLength(1);
    expect(store.addons[0].stripe_subscription_item_id).toBe('si_test_1');
    expect(store.audit.filter((row) => row.action === 'addon_activated')).toHaveLength(1);
  });
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GLOBEX = '10000000-0000-0000-0000-000000000002';
const FIXTURE_CATALOG = 'data_pack_500';

function localDbContainer(): string | null {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    return names.split('\n').map((name) => name.trim()).find((name) => name.startsWith('supabase_db_')) || null;
  } catch {
    return null;
  }
}

function runLocalSql(sql: string) {
  const container = localDbContainer();
  if (!container) throw new Error('Local Supabase database container is not running');
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, encoding: 'utf8' },
  );
}

test.describe('STYL-243 activate_tenant_addon on the local stack', () => {
  test.skip(!serviceKey, 'Requires the local Supabase service role key');

  let admin: SupabaseClient;

  test.beforeAll(() => {
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  test.afterEach(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', FIXTURE_CATALOG);
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'microsoft_calendar_addon');
  });

  test('two concurrent RPC calls leave one active row', async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', FIXTURE_CATALOG);

    const base = {
      p_tenant_id: GLOBEX,
      p_addon_catalog_id: FIXTURE_CATALOG,
      p_feature_id: 'data_chunks_addon',
      p_subscription_status: 'active',
      p_stripe_subscription_id: 'sub_local_fixture',
      p_price_paid_pence: 499,
    };
    const [first, second] = await Promise.all([
      admin.rpc('activate_tenant_addon', { ...base, p_stripe_subscription_item_id: null }),
      admin.rpc('activate_tenant_addon', { ...base, p_stripe_subscription_item_id: 'si_test_1' }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const outcomes = [first.data?.outcome, second.data?.outcome].sort();
    expect(outcomes).toEqual(['already_active', 'inserted']);

    const { data: rows, error } = await admin
      .from('tenant_active_addons')
      .select('id, is_active, stripe_subscription_item_id')
      .eq('tenant_id', GLOBEX)
      .eq('addon_catalog_id', FIXTURE_CATALOG);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0].is_active).toBe(true);
    expect(rows?.[0].stripe_subscription_item_id).toBe('si_test_1');
  });

  test('reactivation updates the inactive row under the full unique constraint', async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', 'microsoft_calendar_addon');
    const { error: insertError } = await admin.from('tenant_active_addons').insert({
      tenant_id: GLOBEX,
      addon_catalog_id: 'microsoft_calendar_addon',
      feature_id: 'microsoft_calendar',
      quantity: 1,
      is_active: false,
      subscription_status: 'cancelled',
    });
    expect(insertError).toBeNull();

    const { data, error } = await admin.rpc('activate_tenant_addon', {
      p_tenant_id: GLOBEX,
      p_addon_catalog_id: 'microsoft_calendar_addon',
      p_feature_id: 'microsoft_calendar',
      p_subscription_status: 'active',
      p_stripe_subscription_id: 'sub_reactivate',
      p_stripe_subscription_item_id: 'si_reactivate',
      p_price_paid_pence: 499,
    });
    expect(error).toBeNull();
    expect(data?.outcome).toBe('reactivated');

    const { data: rows } = await admin
      .from('tenant_active_addons')
      .select('is_active, stripe_subscription_item_id')
      .eq('tenant_id', GLOBEX)
      .eq('addon_catalog_id', 'microsoft_calendar_addon');
    expect(rows).toHaveLength(1);
    expect(rows?.[0].is_active).toBe(true);
    expect(rows?.[0].stripe_subscription_item_id).toBe('si_reactivate');
  });

  test('the duplicate guard refuses without opt-in and deactivates only when asked', () => {
    const sql = `
BEGIN;
INSERT INTO public.tenants (id, company_name, slug)
VALUES ('a2430000-0000-4000-8000-000000000243', 'STYL-243 fixture', 'styl-243-fixture')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tenant_active_addons DROP CONSTRAINT IF EXISTS tenant_active_addons_tenant_catalog_key;
DROP INDEX IF EXISTS public.tenant_active_addons_one_active_per_catalog;

INSERT INTO public.tenant_active_addons (
  id, tenant_id, addon_catalog_id, is_active, quantity, created_at
) VALUES
  ('a2430000-0000-4000-8000-000000000001', 'a2430000-0000-4000-8000-000000000243', 'landline_addon', true, 1, '2026-09-18 13:02:00+00'),
  ('a2430000-0000-4000-8000-000000000002', 'a2430000-0000-4000-8000-000000000243', 'landline_addon', true, 1, '2026-09-18 13:04:00+00');

DO $$
DECLARE
  raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.styl243_guard_active_addon_duplicates();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'STYL-243:%' THEN
      RAISE;
    END IF;
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'expected the duplicate guard to refuse';
  END IF;

  IF (SELECT count(*) FROM public.tenant_active_addons
      WHERE id IN ('a2430000-0000-4000-8000-000000000001', 'a2430000-0000-4000-8000-000000000002')
        AND is_active IS TRUE) <> 2 THEN
    RAISE EXCEPTION 'guard changed rows without opt-in';
  END IF;
END $$;

SELECT set_config('app.styl243_dedupe', 'deactivate_newer', true);
SELECT public.styl243_guard_active_addon_duplicates();

DO $$
DECLARE
  older_active boolean;
  newer_active boolean;
  newer_status text;
  newer_deactivated timestamptz;
  kept int;
BEGIN
  SELECT is_active INTO older_active
    FROM public.tenant_active_addons WHERE id = 'a2430000-0000-4000-8000-000000000001';
  SELECT is_active, subscription_status, deactivated_at
    INTO newer_active, newer_status, newer_deactivated
    FROM public.tenant_active_addons WHERE id = 'a2430000-0000-4000-8000-000000000002';
  SELECT count(*) INTO kept FROM public.tenant_active_addons
   WHERE id IN ('a2430000-0000-4000-8000-000000000001', 'a2430000-0000-4000-8000-000000000002');
  IF older_active IS NOT TRUE OR newer_active IS NOT FALSE OR kept <> 2 THEN
    RAISE EXCEPTION 'dedupe deleted or kept the wrong row (older=% newer=% kept=%)', older_active, newer_active, kept;
  END IF;
  IF newer_status IS DISTINCT FROM 'cancelled' OR newer_deactivated IS NULL THEN
    RAISE EXCEPTION 'newer row was not deactivated with the app fields';
  END IF;
END $$;

ROLLBACK;
`;
    expect(() => runLocalSql(sql)).not.toThrow();
  });
});
