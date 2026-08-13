import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Safe to ignore in Server Components
        }
      },
    },
  });
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment variables missing');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabaseAuth = await getSupabaseAuthClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is superadmin
    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden: Superadmin access required' }, { status: 403 });
    }

    const resolvedParams = await params;
    let tenantId = resolvedParams?.id;
    if (!tenantId && request.url) {
      const urlParts = request.url.split('?')[0].split('/');
      tenantId = urlParts[urlParts.length - 1];
    }

    if (!tenantId || tenantId === 'undefined') {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
    }

    const adminDb = getSupabaseAdminClient();

    // 1. Fetch chatbots associated with this tenant
    const { data: chatbots } = await adminDb
      .from('chatbots')
      .select('id')
      .eq('tenant_id', tenantId);

    const chatbotIds = (chatbots || []).map(b => b.id);

    if (chatbotIds.length > 0) {
      // Delete document_chunks for these chatbots
      await adminDb.from('document_chunks').delete().in('chatbot_id', chatbotIds);

      // Fetch conversations for these chatbots
      const { data: convs } = await adminDb
        .from('conversations')
        .select('id')
        .in('chatbot_id', chatbotIds);

      const convIds = (convs || []).map(c => c.id);
      if (convIds.length > 0) {
        // Delete messages in conversations
        await adminDb.from('messages').delete().in('conversation_id', convIds);
        // Delete conversations
        await adminDb.from('conversations').delete().in('id', convIds);
      }

      // Delete staff and services associated with chatbots
      await adminDb.from('staff').delete().in('chatbot_id', chatbotIds);
      await adminDb.from('services').delete().in('chatbot_id', chatbotIds);

      // Delete chatbots
      await adminDb.from('chatbots').delete().eq('tenant_id', tenantId);
    }

    // 2. Delete tenant specific tables
    await adminDb.from('appointments').delete().eq('tenant_id', tenantId);
    await adminDb.from('usage_ledger').delete().eq('tenant_id', tenantId);
    await adminDb.from('tenant_integrations').delete().eq('tenant_id', tenantId);
    await adminDb.from('tenant_feature_overrides').delete().eq('tenant_id', tenantId);
    await adminDb.from('tenant_active_addons').delete().eq('tenant_id', tenantId);

    // 3. Unlink user profiles linked to this tenant
    await adminDb.from('profiles').update({ tenant_id: null }).eq('tenant_id', tenantId);

    // 4. Finally delete the tenant record
    const { error: deleteTenantError } = await adminDb
      .from('tenants')
      .delete()
      .eq('id', tenantId);

    if (deleteTenantError) {
      console.error('[Tenant DELETE API] Error deleting tenant record:', deleteTenantError);
      return NextResponse.json({ error: deleteTenantError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Tenant ${tenantId} and all associated resources deleted cleanly.`
    });
  } catch (err: any) {
    console.error('[Tenant DELETE API] Unexpected failure:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
