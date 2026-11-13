import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTenantMember, requireTenantRole } from '@/lib/auth/require-tenant-role';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function chatbotInTenant(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  chatbotId: string | null | undefined,
  tenantId: string | null,
): Promise<boolean> {
  if (!chatbotId) return true;
  if (!tenantId) return false;
  const { data } = await supabaseAdmin
    .from('chatbots')
    .select('id, tenant_id')
    .eq('id', chatbotId)
    .maybeSingle();
  return Boolean(data) && String(data.tenant_id) === tenantId;
}

function requestedTenant(raw: string | null | undefined): string | undefined {
  if (!raw || raw === 'undefined') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export async function GET(request: Request) {
  try {
    const auth = await requireTenantMember(request);
    if (!auth.ok) return auth.response;

    const requested = requestedTenant(new URL(request.url).searchParams.get('tenantId'));
    if (requested && requested !== auth.tenantId && !auth.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const tenantId = auth.isSuperAdmin && requested ? requested : auth.tenantId;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('staff')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ staff: data || [] });
  } catch (err: unknown) {
    console.error('Error fetching staff:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireTenantRole(request, ['owner', 'admin']);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { chatbot_id, name, role, email, google_calendar_id, working_days, image_url, specialist_product, bio } = body;

    if (!name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!(await chatbotInTenant(supabaseAdmin, chatbot_id, auth.tenantId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { data, error } = await supabaseAdmin
      .from('staff')
      .insert({
        tenant_id: auth.tenantId,
        chatbot_id: chatbot_id || null,
        name,
        role: role || null,
        email,
        google_calendar_id: google_calendar_id || 'primary',
        working_days: working_days || {},
        image_url,
        specialist_product,
        bio,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ staff: data });
  } catch (err: unknown) {
    console.error('Error creating staff:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireTenantRole(request, ['owner', 'admin']);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { id, chatbot_id, name, role, email, google_calendar_id, working_days, image_url, specialist_product, bio } = body;

    if (!id || !name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: existing } = await supabaseAdmin
      .from('staff')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!auth.isSuperAdmin && String(existing.tenant_id) !== auth.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const staffTenantId = auth.isSuperAdmin ? String(existing.tenant_id) : auth.tenantId;
    if (!(await chatbotInTenant(supabaseAdmin, chatbot_id, staffTenantId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from('staff')
      .update({
        chatbot_id: chatbot_id || null,
        name,
        role: role || null,
        email,
        google_calendar_id: google_calendar_id || 'primary',
        working_days: working_days || {},
        image_url,
        specialist_product,
        bio,
      })
      .eq('id', id)
      .eq('tenant_id', auth.isSuperAdmin ? existing.tenant_id : auth.tenantId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ staff: data });
  } catch (err: unknown) {
    console.error('Error updating staff:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireTenantRole(request, ['owner', 'admin']);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const requested = requestedTenant(searchParams.get('tenantId'));
    if (requested && requested !== auth.tenantId && !auth.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: existing } = await supabaseAdmin
      .from('staff')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!auth.isSuperAdmin && String(existing.tenant_id) !== auth.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('staff')
      .delete()
      .eq('id', id)
      .eq('tenant_id', existing.tenant_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error deleting staff:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
