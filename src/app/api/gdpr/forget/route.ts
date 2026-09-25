import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { sendGdprErasureRequestEmail } from '@/lib/lead-notifier';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase Service Role configuration');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !key) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, key, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      },
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      return NextResponse.json({ error: 'No active B2B tenant account found for user profile.' }, { status: 403 });
    }

    const body = await req.json();
    const { action = 'request', searchQuery, confirmDelete = false } = body;

    const cleanQuery = (searchQuery || '').trim();
    if (!cleanQuery) {
      return NextResponse.json({ error: 'Customer search identifier (Name, Email address, or Phone number) is required.' }, { status: 400 });
    }

    const tenantId = profile.tenant_id;

    // Retrieve Tenant Details
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, company_name, slug')
      .eq('id', tenantId)
      .single();

    // Default Action: Submit GDPR Request Email to StyleFlo Admin (admin@styleflo.ai)
    if (action === 'request' || action === 'notify') {
      await sendGdprErasureRequestEmail({
        tenantId,
        businessName: tenant?.company_name || 'B2B Account',
        tenantSlug: tenant?.slug || '',
        customerIdentifier: cleanQuery,
        requestedByEmail: user.email || 'B2B Admin',
      });

      return NextResponse.json({
        success: true,
        message: `GDPR Right to be Forgotten request for '${cleanQuery}' has been submitted to StyleFlo Data Privacy team.`,
        tenant: {
          id: tenant?.id || tenantId,
          company_name: tenant?.company_name || 'Your Business',
        },
        searchQuery: cleanQuery,
      });
    }

    if (action === 'search' || action === 'export') {
      const { data: appts } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenantId)
        .or(`customer_name.ilike.%${cleanQuery}%,customer_email.ilike.%${cleanQuery}%,customer_phone.ilike.%${cleanQuery}%`);

      const { data: convs } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .or(`user_session_id.ilike.%${cleanQuery}%,transcript.ilike.%${cleanQuery}%`);

      const convIds = (convs || []).map(c => c.id);
      let msgs: any[] = [];
      if (convIds.length > 0) {
        const { data: msgData } = await supabaseAdmin
          .from('messages')
          .select('*')
          .eq('tenant_id', tenantId)
          .or(`text_content.ilike.%${cleanQuery}%,conversation_id.in.(${convIds.join(',')})`);
        msgs = msgData || [];
      } else {
        const { data: msgData } = await supabaseAdmin
          .from('messages')
          .select('*')
          .eq('tenant_id', tenantId)
          .ilike('text_content', `%${cleanQuery}%`);
        msgs = msgData || [];
      }

      const returnedAppointments = appts || [];
      const returnedConversations = convs || [];
      const returnedMessages = msgs || [];
      const totalRecords = returnedAppointments.length + returnedConversations.length + returnedMessages.length;

      return NextResponse.json({
        success: true,
        action,
        tenant: {
          id: tenant?.id || tenantId,
          company_name: tenant?.company_name || 'Your Business',
          slug: tenant?.slug || ''
        },
        searchQuery: cleanQuery,
        summary: {
          totalAppointments: returnedAppointments.length,
          totalConversations: returnedConversations.length,
          totalMessages: returnedMessages.length,
          totalRecords
        },
        data: {
          appointments: returnedAppointments,
          conversations: returnedConversations,
          messages: returnedMessages
        }
      });
    }

    if (action === 'delete') {
      if (!confirmDelete) {
        return NextResponse.json({ error: 'Confirmation (confirmDelete: true) required for deletion.' }, { status: 400 });
      }

      const { data: deletedAppts } = await supabaseAdmin
        .from('appointments')
        .delete()
        .eq('tenant_id', tenantId)
        .or(`customer_name.ilike.%${cleanQuery}%,customer_email.ilike.%${cleanQuery}%,customer_phone.ilike.%${cleanQuery}%`)
        .select('id');

      const { data: matchingConvs } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .or(`user_session_id.ilike.%${cleanQuery}%,transcript.ilike.%${cleanQuery}%`);

      const convIdsToDelete = (matchingConvs || []).map(c => c.id);
      let deletedMsgsCount = 0;
      let deletedConvsCount = 0;

      if (convIdsToDelete.length > 0) {
        const { data: delMsgs } = await supabaseAdmin
          .from('messages')
          .delete()
          .eq('tenant_id', tenantId)
          .in('conversation_id', convIdsToDelete)
          .select('id');
        if (delMsgs) deletedMsgsCount += delMsgs.length;

        const { data: delConvs } = await supabaseAdmin
          .from('conversations')
          .delete()
          .eq('tenant_id', tenantId)
          .in('id', convIdsToDelete)
          .select('id');
        if (delConvs) deletedConvsCount = delConvs.length;
      }

      const { data: standaloneMsgs } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('tenant_id', tenantId)
        .ilike('text_content', `%${cleanQuery}%`)
        .select('id');
      if (standaloneMsgs) deletedMsgsCount += standaloneMsgs.length;

      const deletedApptsCount = deletedAppts ? deletedAppts.length : 0;
      const totalErased = deletedApptsCount + deletedConvsCount + deletedMsgsCount;

      return NextResponse.json({
        success: true,
        message: `Customer data for '${cleanQuery}' was deleted successfully under your B2B account.`,
        tenant: {
          id: tenant?.id || tenantId,
          company_name: tenant?.company_name || 'Your Business'
        },
        searchQuery: cleanQuery,
        erasedSummary: {
          deletedAppointments: deletedApptsCount,
          deletedConversations: deletedConvsCount,
          deletedMessages: deletedMsgsCount,
          totalRecordsErased: totalErased
        }
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('[GDPR Forget API] Error:', err);
    return NextResponse.json({ error: err.message || 'Error processing request' }, { status: 500 });
  }
}
