import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantRole, type TenantRole } from '@/lib/auth/require-tenant-role';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function resolveTenant(request: Request, roles: TenantRole[]) {
  const auth = await requireTenantRole(request, roles);
  if (!auth.ok) return auth;
  const requested = new URL(request.url).searchParams.get('tenantId');
  if (requested && requested !== auth.tenantId && !auth.isSuperAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  const tenantId = auth.isSuperAdmin && requested ? requested : auth.tenantId;
  if (!tenantId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Missing tenantId' }, { status: 400 }),
    };
  }
  return { ok: true as const, tenantId };
}

export async function GET(request: Request) {
  try {
    const auth = await resolveTenant(request, ['owner', 'admin', 'member']);
    if (!auth.ok) return auth.response;
    const tenantId = auth.tenantId;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('tenant_integrations')
      .select('id, provider, updated_at')
      .eq('tenant_id', tenantId)
      .eq('provider', 'google_calendar')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      throw error;
    }

    return NextResponse.json({
      connected: !!data,
      integration: data
        ? { id: data.id, provider: data.provider, updated_at: data.updated_at }
        : null
    });
  } catch (err: any) {
    console.error('Error fetching integration status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveTenant(request, ['owner', 'admin']);
    if (!auth.ok) return auth.response;
    const tenantId = auth.tenantId;

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('tenant_integrations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', 'google_calendar');

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting integration:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

