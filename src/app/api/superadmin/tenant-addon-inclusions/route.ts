import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';

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

export const GET = withSuperAdmin(async (req: NextRequest) => {
  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('tenant_addon_inclusions')
    .select('id, tenant_id, addon_catalog_id, included, price_paid_pence, updated_at')
    .eq('tenant_id', tenantId)
    .order('addon_catalog_id', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ inclusions: data || [] });
});

export const PUT = withSuperAdmin(async (req: NextRequest, _ctx, admin) => {
  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenant_id === 'string' ? body.tenant_id : '';
  const addonCatalogId = typeof body?.addon_catalog_id === 'string' ? body.addon_catalog_id : '';
  const included = body?.included === true;
  const pricePaid = Number(body?.price_paid_pence);

  if (!tenantId || !addonCatalogId) {
    return NextResponse.json({ error: 'tenant_id and addon_catalog_id are required' }, { status: 400 });
  }
  if (!Number.isInteger(pricePaid) || pricePaid < 0) {
    return NextResponse.json({ error: 'price_paid_pence must be a whole number of pence, zero or more' }, { status: 400 });
  }

  const supabase = adminClient();
  const [{ data: tenant }, { data: addon }] = await Promise.all([
    supabase.from('tenants').select('id').eq('id', tenantId).maybeSingle(),
    supabase.from('addon_catalog').select('id, name').eq('id', addonCatalogId).maybeSingle(),
  ]);

  if (!tenant) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  if (!addon) return NextResponse.json({ error: 'Bolt-on not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('tenant_addon_inclusions')
    .upsert({
      tenant_id: tenantId,
      addon_catalog_id: addonCatalogId,
      included,
      price_paid_pence: pricePaid,
      created_by: admin.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,addon_catalog_id' })
    .select('id, tenant_id, addon_catalog_id, included, price_paid_pence')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from('addon_audit_log').insert({
    tenant_id: tenantId,
    addon_catalog_id: addonCatalogId,
    action: 'addon_updated',
    new_value: { included, price_paid_pence: pricePaid },
    summary: included
      ? `Included ${addon.name} on this account at ${(pricePaid / 100).toFixed(2)} pounds per month.`
      : `Turned off the include switch for ${addon.name}.`,
    performed_by: admin.userId,
  });

  return NextResponse.json({ inclusion: data });
});
