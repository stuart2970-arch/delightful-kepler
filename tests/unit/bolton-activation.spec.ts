import { test, expect } from '@playwright/test';
import {
  buildBoltOnCheckoutMetadata,
  isBoltOnMetadata,
  knowledgeItemsTotal,
  mapAddonCategoryToFeatureId,
  resolveCalendarAddonFlags,
  resolveCheckoutSuccessBanner,
} from '../../src/lib/billing/bolt-on';
import { handleStripeBillingEvent } from '../../src/lib/billing/process-stripe-webhook';

const TENANT_ID = 'tenant-bolton-1';
const DATA_PACK_ID = 'data_pack_500';
const GOOGLE_CAL_ID = 'google_calendar_addon';
const MS_CAL_ID = 'microsoft_calendar_addon';

type TenantRow = {
  id: string;
  plan_tier: string;
  is_active: boolean;
  subscription_status: string;
  stripe_customer_id?: string | null;
  has_landline?: boolean;
  has_mobile?: boolean;
  has_whatsapp?: boolean;
};

type AddonCatalogRow = {
  id: string;
  category: string;
  is_active: boolean;
  monthly_price_pence: number;
  included_voice_minutes: number;
  included_sms: number;
  included_messages: number;
  included_data_chunks: number;
};

type ActiveAddonRow = {
  id: string;
  tenant_id: string;
  addon_catalog_id: string;
  feature_id: string;
  quantity: number;
  is_active: boolean;
  activated_at?: string | null;
  deactivated_at?: string | null;
  stripe_subscription_item_id?: string | null;
  price_paid_pence?: number | null;
};

function createFakeBillingDb(seed?: {
  tenant?: Partial<TenantRow>;
  catalog?: AddonCatalogRow[];
  activeAddons?: ActiveAddonRow[];
}) {
  const tenants: TenantRow[] = [
    {
      id: TENANT_ID,
      plan_tier: 'premium',
      is_active: true,
      subscription_status: 'active',
      stripe_customer_id: 'cus_existing',
      has_landline: true,
      has_mobile: true,
      has_whatsapp: true,
      ...seed?.tenant,
    },
  ];

  const catalog: AddonCatalogRow[] = seed?.catalog || [
    {
      id: DATA_PACK_ID,
      category: 'data_pack',
      is_active: true,
      monthly_price_pence: 499,
      included_voice_minutes: 0,
      included_sms: 0,
      included_messages: 0,
      included_data_chunks: 500,
    },
    {
      id: GOOGLE_CAL_ID,
      category: 'google_calendar',
      is_active: true,
      monthly_price_pence: 499,
      included_voice_minutes: 0,
      included_sms: 0,
      included_messages: 0,
      included_data_chunks: 0,
    },
    {
      id: MS_CAL_ID,
      category: 'microsoft_calendar',
      is_active: true,
      monthly_price_pence: 499,
      included_voice_minutes: 0,
      included_sms: 0,
      included_messages: 0,
      included_data_chunks: 0,
    },
    {
      id: 'voice_pack_20',
      category: 'voice_pack',
      is_active: true,
      monthly_price_pence: 1200,
      included_voice_minutes: 20,
      included_sms: 0,
      included_messages: 0,
      included_data_chunks: 0,
    },
    {
      id: 'sms_pack_100',
      category: 'sms_pack',
      is_active: true,
      monthly_price_pence: 900,
      included_voice_minutes: 0,
      included_sms: 100,
      included_messages: 0,
      included_data_chunks: 0,
    },
  ];

  const activeAddons: ActiveAddonRow[] = [...(seed?.activeAddons || [])];
  const audit: any[] = [];
  const rpcCalls: Array<{ name: string; args: any }> = [];

  const matches = (row: Record<string, any>, filters: Array<[string, any]>) =>
    filters.every(([col, val]) => row[col] === val);

  function from(table: string) {
    const filters: Array<[string, any]> = [];
    let pendingUpdate: Record<string, any> | null = null;
    let pendingInsert: any = null;

    const api: any = {
      select() {
        return api;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return api;
      },
      async maybeSingle() {
        if (table === 'tenants') {
          return { data: tenants.find((row) => matches(row, filters)) || null, error: null };
        }
        if (table === 'addon_catalog') {
          return { data: catalog.find((row) => matches(row, filters)) || null, error: null };
        }
        if (table === 'tenant_active_addons') {
          return { data: activeAddons.find((row) => matches(row, filters)) || null, error: null };
        }
        if (table === 'addon_audit_log') {
          return { data: audit.find((row) => matches(row, filters)) || null, error: null };
        }
        return { data: null, error: null };
      },
      update(payload: Record<string, any>) {
        pendingUpdate = payload;
        return api;
      },
      insert(row: any) {
        pendingInsert = row;
        return api;
      },
      then(resolve: (value: any) => void, reject?: (reason: any) => void) {
        return Promise.resolve()
          .then(() => {
            if (pendingInsert) {
              const rows = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
              if (table === 'tenant_active_addons') {
                for (const row of rows) {
                  activeAddons.push({
                    id: row.id || `taa-${activeAddons.length + 1}`,
                    quantity: 1,
                    is_active: true,
                    ...row,
                  });
                }
              }
              if (table === 'addon_audit_log') {
                audit.push(...rows);
              }
              return { data: rows, error: null };
            }
            if (pendingUpdate) {
              if (table === 'tenants') {
                for (const row of tenants) {
                  if (matches(row, filters)) Object.assign(row, pendingUpdate);
                }
              }
              if (table === 'tenant_active_addons') {
                for (const row of activeAddons) {
                  if (matches(row, filters)) Object.assign(row, pendingUpdate);
                }
              }
              return { data: null, error: null };
            }
            if (table === 'tenant_active_addons') {
              return { data: activeAddons.filter((row) => matches(row, filters)), error: null };
            }
            if (table === 'addon_audit_log') {
              return { data: audit.filter((row) => matches(row, filters)), error: null };
            }
            return { data: null, error: null };
          })
          .then(resolve, reject);
      },
    };
    return api;
  }

  return {
    state: { tenants, catalog, activeAddons, audit, rpcCalls },
    from,
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
  };
}

test.describe('Bolt-on checkout metadata', () => {
  test('bolt-on checkout session metadata includes is_addon and addon_catalog_id', () => {
    const metadata = buildBoltOnCheckoutMetadata({
      tenantId: TENANT_ID,
      addonCatalogId: DATA_PACK_ID,
      category: 'data_pack',
      isSliding: false,
      pricePence: 499,
      voiceMinutes: 0,
      sms: 0,
      isOneOff: false,
    });

    expect(metadata.is_addon).toBe('true');
    expect(metadata.addon_catalog_id).toBe(DATA_PACK_ID);
    expect(metadata.tenant_id).toBe(TENANT_ID);
    expect(metadata.category).toBe('data_pack');
  });

  test('sliding bolt-on checkout metadata still sets is_addon', () => {
    const metadata = buildBoltOnCheckoutMetadata({
      tenantId: TENANT_ID,
      addonCatalogId: 'landline_addon',
      category: 'landline',
      isSliding: true,
      pricePence: 999,
      voiceMinutes: 20,
      sms: 0,
      isOneOff: false,
    });

    expect(metadata.is_addon).toBe('true');
    expect(metadata.addon_catalog_id).toBe('landline_addon');
    expect(metadata.is_sliding).toBe('true');
  });
});

test.describe('Bolt-on webhook detection and fulfilment', () => {
  test('detects bolt-ons by is_addon or addon_catalog_id, but not base-plan metadata', () => {
    expect(isBoltOnMetadata({ is_addon: 'true' })).toBe(true);
    expect(isBoltOnMetadata({ addon_catalog_id: DATA_PACK_ID })).toBe(true);
    expect(isBoltOnMetadata({
      tenant_id: TENANT_ID,
      plan_tier: 'base_tier',
      selected_addons: DATA_PACK_ID,
    })).toBe(false);
    expect(isBoltOnMetadata({})).toBe(false);
  });

  test('maps microsoft_calendar to the Microsoft Calendar feature', () => {
    expect(mapAddonCategoryToFeatureId('microsoft_calendar')).toBe('microsoft_calendar');
    expect(mapAddonCategoryToFeatureId('google_calendar')).toBe('google_calendar');
    expect(mapAddonCategoryToFeatureId('data_pack')).toBe('data_chunks_addon');
  });

  test('bolt-on checkout.session.completed creates the bolt-on row and leaves plan_tier and voice minutes alone', async () => {
    const db = createFakeBillingDb();
    const allocations: Array<[string, string, number, string?]> = [];

    const result = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_data_pack_1',
            customer: 'cus_new',
            metadata: {
              tenant_id: TENANT_ID,
              addon_catalog_id: DATA_PACK_ID,
              is_addon: 'true',
              price_pence: '499',
            },
          },
        },
      },
      {
        supabaseAdmin: db,
        allocateRollingCredits: async (tenantId, featureId, quantity, addonId) => {
          allocations.push([tenantId, featureId, quantity, addonId]);
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.message).toMatch(/Add-on data_pack_500/);
    expect(db.state.tenants[0].plan_tier).toBe('premium');
    expect(db.state.tenants[0].is_active).toBe(true);
    expect(allocations.filter((row) => row[1] === 'voice_minutes')).toHaveLength(0);
    expect(db.state.activeAddons).toHaveLength(1);
    expect(db.state.activeAddons[0].addon_catalog_id).toBe(DATA_PACK_ID);
    expect(db.state.activeAddons[0].is_active).toBe(true);
    expect(db.state.activeAddons[0].feature_id).toBe('data_chunks_addon');
  });

  test('bolt-on checkout without is_addon still activates via addon_catalog_id', async () => {
    const db = createFakeBillingDb();
    const result = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_google_1',
            metadata: {
              tenant_id: TENANT_ID,
              addon_catalog_id: GOOGLE_CAL_ID,
            },
          },
        },
      },
      { supabaseAdmin: db, allocateRollingCredits: async () => undefined },
    );

    expect(result.status).toBe(200);
    expect(db.state.tenants[0].plan_tier).toBe('premium');
    expect(db.state.activeAddons[0].addon_catalog_id).toBe(GOOGLE_CAL_ID);
    expect(db.state.activeAddons[0].is_active).toBe(true);
    expect(db.state.activeAddons[0].feature_id).toBe('google_calendar');
  });

  test('Microsoft Calendar bolt-on is marked active', async () => {
    const db = createFakeBillingDb();
    await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_ms_1',
            metadata: { tenant_id: TENANT_ID, addon_catalog_id: MS_CAL_ID, is_addon: 'true' },
          },
        },
      },
      { supabaseAdmin: db, allocateRollingCredits: async () => undefined },
    );

    expect(db.state.activeAddons[0].addon_catalog_id).toBe(MS_CAL_ID);
    expect(db.state.activeAddons[0].feature_id).toBe('microsoft_calendar');
    expect(db.state.activeAddons[0].is_active).toBe(true);
  });

  test('redelivered bolt-on checkout does not insert a second row', async () => {
    const db = createFakeBillingDb();
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_data_pack_repeat',
          metadata: { tenant_id: TENANT_ID, addon_catalog_id: DATA_PACK_ID, is_addon: 'true' },
        },
      },
    };

    await handleStripeBillingEvent(event, {
      supabaseAdmin: db,
      allocateRollingCredits: async () => undefined,
    });
    await handleStripeBillingEvent(event, {
      supabaseAdmin: db,
      allocateRollingCredits: async () => undefined,
    });

    expect(db.state.activeAddons).toHaveLength(1);
    expect(db.state.activeAddons[0].is_active).toBe(true);
  });

  test('bolt-on customer.subscription.deleted deactivates only that bolt-on and leaves the tenant active', async () => {
    const db = createFakeBillingDb({
      activeAddons: [
        {
          id: 'taa-1',
          tenant_id: TENANT_ID,
          addon_catalog_id: DATA_PACK_ID,
          feature_id: 'data_chunks_addon',
          quantity: 1,
          is_active: true,
        },
        {
          id: 'taa-2',
          tenant_id: TENANT_ID,
          addon_catalog_id: GOOGLE_CAL_ID,
          feature_id: 'google_calendar',
          quantity: 1,
          is_active: true,
        },
      ],
    });

    const result = await handleStripeBillingEvent(
      {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_bolton_1',
            metadata: {
              tenant_id: TENANT_ID,
              addon_catalog_id: DATA_PACK_ID,
            },
          },
        },
      },
      { supabaseAdmin: db },
    );

    expect(result.status).toBe(200);
    expect(db.state.tenants[0].is_active).toBe(true);
    expect(db.state.tenants[0].subscription_status).toBe('active');
    expect(db.state.tenants[0].has_landline).toBe(true);
    expect(db.state.activeAddons.find((row) => row.addon_catalog_id === DATA_PACK_ID)?.is_active).toBe(false);
    expect(db.state.activeAddons.find((row) => row.addon_catalog_id === GOOGLE_CAL_ID)?.is_active).toBe(true);
  });

  test('base-plan checkout.session.completed still sets plan_tier and allocates 10 voice minutes', async () => {
    const db = createFakeBillingDb({
      tenant: { plan_tier: 'trial', is_active: false, subscription_status: 'incomplete' },
    });
    const allocations: Array<[string, string, number, string?]> = [];

    const result = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_base_1',
            customer: 'cus_base',
            customer_details: { email: 'owner@example.com' },
            metadata: { tenant_id: TENANT_ID, plan_tier: 'base_tier' },
          },
        },
      },
      {
        supabaseAdmin: db,
        allocateRollingCredits: async (tenantId, featureId, quantity, addonId) => {
          allocations.push([tenantId, featureId, quantity, addonId]);
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.plan_tier).toBe('base_tier');
    expect(db.state.tenants[0].plan_tier).toBe('base_tier');
    expect(db.state.tenants[0].is_active).toBe(true);
    expect(db.state.tenants[0].subscription_status).toBe('active');
    expect(allocations).toEqual([[TENANT_ID, 'voice_minutes', 10, undefined]]);
    expect(db.state.activeAddons).toHaveLength(0);
  });

  test('base-plan subscription.deleted still deactivates the tenant', async () => {
    const db = createFakeBillingDb({
      activeAddons: [
        {
          id: 'taa-1',
          tenant_id: TENANT_ID,
          addon_catalog_id: DATA_PACK_ID,
          feature_id: 'data_chunks_addon',
          quantity: 1,
          is_active: true,
        },
      ],
    });

    await handleStripeBillingEvent(
      {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_base',
            metadata: { tenant_id: TENANT_ID, plan_tier: 'base_tier' },
          },
        },
      },
      { supabaseAdmin: db },
    );

    expect(db.state.tenants[0].is_active).toBe(false);
    expect(db.state.tenants[0].subscription_status).toBe('cancelled');
    expect(db.state.activeAddons.every((row) => row.is_active === false)).toBe(true);
  });

  test('subscription.updated activates a bolt-on from subscription metadata, not stripe_price_id', async () => {
    const db = createFakeBillingDb();
    const result = await handleStripeBillingEvent(
      {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_inline_price',
            status: 'active',
            metadata: {
              tenant_id: TENANT_ID,
              addon_catalog_id: MS_CAL_ID,
              is_addon: 'true',
            },
            items: { data: [{ id: 'si_1', price: { id: 'price_inline_unknown', unit_amount: 499 } }] },
          },
        },
      },
      { supabaseAdmin: db, allocateRollingCredits: async () => undefined },
    );

    expect(result.status).toBe(200);
    expect(db.state.activeAddons).toHaveLength(1);
    expect(db.state.activeAddons[0].addon_catalog_id).toBe(MS_CAL_ID);
    expect(db.state.activeAddons[0].is_active).toBe(true);
  });

  test('subscription.updated ignores unpaid, canceled, and incomplete bolt-on statuses', async () => {
    const allocations: Array<[string, string, number, string?]> = [];
    for (const status of ['incomplete', 'past_due', 'unpaid', 'canceled', 'cancelled']) {
      const db = createFakeBillingDb();
      await handleStripeBillingEvent(
        {
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: `sub_${status}`,
              status,
              metadata: { tenant_id: TENANT_ID, addon_catalog_id: MS_CAL_ID, is_addon: 'true' },
              items: { data: [{ id: 'si_1', price: { id: 'price_inline_unknown', unit_amount: 499 } }] },
            },
          },
        },
        {
          supabaseAdmin: db,
          allocateRollingCredits: async (tenantId, featureId, quantity, addonId) => {
            allocations.push([tenantId, featureId, quantity, addonId]);
          },
        },
      );
      expect(db.state.activeAddons, status).toHaveLength(0);
      expect(db.state.tenants[0].plan_tier, status).toBe('premium');
    }
    expect(allocations).toHaveLength(0);
  });

  test('one-off voice and SMS pack redelivery does not double-grant credits', async () => {
    const db = createFakeBillingDb();
    const allocations: Array<[string, string, number, string?]> = [];
    const voiceEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_voice_once',
          metadata: {
            tenant_id: TENANT_ID,
            addon_catalog_id: 'voice_pack_20',
            is_addon: 'true',
            is_one_off: 'true',
            voice_minutes: '20',
          },
        },
      },
    };
    const smsEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sms_once',
          metadata: {
            tenant_id: TENANT_ID,
            addon_catalog_id: 'sms_pack_100',
            is_addon: 'true',
            is_one_off: 'true',
            sms: '100',
          },
        },
      },
    };
    const deps = {
      supabaseAdmin: db,
      allocateRollingCredits: async (tenantId: string, featureId: string, quantity: number, addonId?: string) => {
        allocations.push([tenantId, featureId, quantity, addonId]);
      },
    };

    await handleStripeBillingEvent(voiceEvent, deps);
    await handleStripeBillingEvent(voiceEvent, deps);
    await handleStripeBillingEvent(smsEvent, deps);
    await handleStripeBillingEvent(smsEvent, deps);

    expect(allocations.filter((row) => row[1] === 'voice_minutes')).toEqual([[TENANT_ID, 'voice_minutes', 20, 'voice_pack_20']]);
    expect(allocations.filter((row) => row[1] === 'sms_messages')).toEqual([[TENANT_ID, 'sms_messages', 100, 'sms_pack_100']]);
    expect(db.state.tenants[0].plan_tier).toBe('premium');
  });

  test('missing catalogue or addon_catalog_id never falls through to the base-plan path', async () => {
    const db = createFakeBillingDb();
    const allocations: Array<[string, string, number, string?]> = [];
    const deps = {
      supabaseAdmin: db,
      allocateRollingCredits: async (tenantId: string, featureId: string, quantity: number, addonId?: string) => {
        allocations.push([tenantId, featureId, quantity, addonId]);
      },
    };

    const missingCatalog = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_missing_catalog',
            metadata: { tenant_id: TENANT_ID, addon_catalog_id: 'not_in_catalog', is_addon: 'true' },
          },
        },
      },
      deps,
    );
    const missingId = await handleStripeBillingEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_missing_id',
            metadata: { tenant_id: TENANT_ID, is_addon: 'true' },
          },
        },
      },
      deps,
    );

    expect(missingCatalog.body.success).toBe(false);
    expect(missingId.body.success).toBe(false);
    expect(db.state.tenants[0].plan_tier).toBe('premium');
    expect(db.state.tenants[0].is_active).toBe(true);
    expect(db.state.activeAddons).toHaveLength(0);
    expect(allocations).toHaveLength(0);
  });
});

test.describe('Bolt-on flags and knowledge totals', () => {
  test('Microsoft Calendar bolt-on row sets the Microsoft flag', () => {
    const flags = resolveCalendarAddonFlags({
      addons: [{ category: 'microsoft_calendar', addon_catalog_id: MS_CAL_ID, is_active: true }],
    });
    expect(flags.hasMicrosoftCalendarAddon).toBe(true);
    expect(flags.hasGoogleCalendarAddon).toBe(false);
  });

  test('knowledge items total includes Extra Knowledge bolt-on allowance', () => {
    expect(knowledgeItemsTotal({
      entitlements: [{ feature_id: 'knowledge_data_chunks', limit_value: 50 }],
      addons: [{ category: 'data_pack', addon_catalog_id: DATA_PACK_ID, included_data_chunks: 500, is_active: true }],
    })).toBe(550);
  });
});

test.describe('Bolt-on success banners', () => {
  test('Extra Knowledge banner says knowledge items and does not claim the bolt-on is already active', () => {
    const message = resolveCheckoutSuccessBanner({ addonId: DATA_PACK_ID, tab: 'crawler' });
    expect(message.toLowerCase()).toContain('knowledge items');
    expect(message.toLowerCase()).not.toContain('chunk');
    expect(message.toLowerCase()).not.toContain('vector storage');
    expect(message.toLowerCase()).not.toContain('now active');
    expect(message).toMatch(/Payment received\. Your bolt-on will switch on in a moment\./);
  });

  test('calendar banners do not say now active', () => {
    const google = resolveCheckoutSuccessBanner({ addonId: GOOGLE_CAL_ID });
    const microsoft = resolveCheckoutSuccessBanner({ addonId: MS_CAL_ID });
    expect(google.toLowerCase()).not.toContain('now active');
    expect(microsoft.toLowerCase()).not.toContain('now active');
    expect(microsoft).toMatch(/Microsoft Calendar/);
    expect(google).not.toMatch(/Microsoft Calendar/);
  });
});
