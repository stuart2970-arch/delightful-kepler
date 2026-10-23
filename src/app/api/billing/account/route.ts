import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '@/lib/auth/require-superadmin';
import { buildAccountOwnership, planHeadingName } from '@/lib/billing/account-ownership';
import type { CatalogAddon, InclusionRecord, PurchaseRecord } from '@/lib/billing/account-ownership';

export const dynamic = 'force-dynamic';

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role configuration');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * What the logged-in salon owns.
 * The WordPress account page can call this later. It never accepts another tenant id.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = adminClient();
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', auth.userId)
      .maybeSingle();

    if (profileError || !profile?.tenant_id) {
      return NextResponse.json({ error: 'No account is linked to this login' }, { status: 404 });
    }

    const tenantId = profile.tenant_id as string;
    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenantId)
      .maybeSingle();

    const tierId = tenant?.plan_tier || 'foundation';
    const { data: tier } = await supabase
      .from('subscription_tiers')
      .select('name, monthly_price')
      .eq('id', tierId)
      .maybeSingle();

    const { data: catalogRows } = await supabase
      .from('addon_catalog')
      .select('id, name, description, category, monthly_price_pence, is_sliding, is_active, display_order')
      .order('display_order', { ascending: true });

    const { data: purchaseRows } = await supabase
      .from('tenant_active_addons')
      .select('addon_catalog_id, is_active, price_paid_pence')
      .eq('tenant_id', tenantId);

    const { data: inclusionRows, error: inclusionError } = await supabase
      .from('tenant_addon_inclusions')
      .select('addon_catalog_id, included, price_paid_pence')
      .eq('tenant_id', tenantId);

    if (inclusionError) {
      console.warn('[Billing Account] Include switch is not available yet:', inclusionError.message);
    }

    const planPricePence = tier?.monthly_price == null ? null : Math.round(Number(tier.monthly_price) * 100);
    const ownership = buildAccountOwnership({
      plan: {
        name: planHeadingName(tier?.name || tierId),
        price_pence: planPricePence,
      },
      catalog: (catalogRows || []) as CatalogAddon[],
      purchases: (purchaseRows || []) as PurchaseRecord[],
      inclusions: inclusionError ? [] : ((inclusionRows || []) as InclusionRecord[]),
    });

    return NextResponse.json({
      tenant_id: tenantId,
      ...ownership,
    });
  } catch (error) {
    console.error('[Billing Account] Failed to load ownership:', error);
    return NextResponse.json({ error: 'Could not load this account' }, { status: 500 });
  }
}
