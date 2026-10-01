import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    
    // Check both tenant_integrations and tenants.microsoft_refresh_token
    const [{ data: integration }, { data: tenant }] = await Promise.all([
      supabaseAdmin
        .from('tenant_integrations')
        .select('id, provider, updated_at, account_email')
        .eq('tenant_id', tenantId)
        .eq('provider', 'microsoft_calendar')
        .maybeSingle(),
      supabaseAdmin
        .from('tenants')
        .select('microsoft_refresh_token')
        .eq('id', tenantId)
        .maybeSingle()
    ]);

    const isConnected = !!integration || !!(tenant && tenant.microsoft_refresh_token);

    return NextResponse.json({
      connected: isConnected,
      integration: integration || (tenant?.microsoft_refresh_token ? { provider: 'microsoft_calendar' } : null)
    });
  } catch (err: any) {
    console.error('Error fetching Microsoft integration status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    await Promise.all([
      supabaseAdmin
        .from('tenant_integrations')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('provider', 'microsoft_calendar'),
      supabaseAdmin
        .from('tenants')
        .update({ microsoft_refresh_token: null })
        .eq('id', tenantId)
    ]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting Microsoft integration:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
