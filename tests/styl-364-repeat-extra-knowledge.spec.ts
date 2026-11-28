import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const GLOBEX = '10000000-0000-0000-0000-000000000002';
const DATA_PACK_ID = 'data_pack_500';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test.describe('STYL-364 multiple Extra Knowledge purchases', () => {
  test.afterEach(async () => {
    await admin.from('tenant_active_addons').delete().eq('tenant_id', GLOBEX).eq('addon_catalog_id', DATA_PACK_ID);
  });

  test('activate_tenant_addon inserts a second active row for data_pack_500', async () => {
    const first = await admin.rpc('activate_tenant_addon', {
      p_tenant_id: GLOBEX,
      p_addon_catalog_id: DATA_PACK_ID,
      p_feature_id: 'data_chunks_addon',
      p_subscription_status: 'active',
      p_stripe_subscription_id: 'sub_pack_1',
      p_stripe_subscription_item_id: 'si_pack_1',
      p_price_paid_pence: 999,
    });
    expect(first.error).toBeNull();
    expect(first.data?.outcome).toBe('inserted');

    const second = await admin.rpc('activate_tenant_addon', {
      p_tenant_id: GLOBEX,
      p_addon_catalog_id: DATA_PACK_ID,
      p_feature_id: 'data_chunks_addon',
      p_subscription_status: 'active',
      p_stripe_subscription_id: 'sub_pack_2',
      p_stripe_subscription_item_id: 'si_pack_2',
      p_price_paid_pence: 999,
    });
    expect(second.error).toBeNull();
    expect(second.data?.outcome).toBe('inserted');

    const { data: rows } = await admin
      .from('tenant_active_addons')
      .select('id')
      .eq('tenant_id', GLOBEX)
      .eq('addon_catalog_id', DATA_PACK_ID)
      .eq('is_active', true);
    expect(rows?.length).toBe(2);
  });
});