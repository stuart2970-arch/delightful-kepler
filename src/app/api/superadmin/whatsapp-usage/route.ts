import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Superadmin WhatsApp Usage & Connected Accounts API
 * Returns multi-tenant aggregated WhatsApp metrics, active accounts, daily breakdown, and CSV export.
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    const supabaseAdmin = getSupabaseAdmin();
    let user = (await supabase.auth.getUser()).data?.user;
    if (!user) {
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.is_super_admin) {
      return NextResponse.json({ error: 'Superadmin privileges required' }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const format = searchParams.get('format') || searchParams.get('export');
    const tenantIdFilter = searchParams.get('tenantId');
    const limit = parseInt(searchParams.get('limit') || '200', 10);

    // 1. Fetch all WhatsApp accounts with tenant details
    const { data: rawAccounts, error: accountsError } = await supabaseAdmin
      .from('whatsapp_accounts')
      .select(`
        id,
        tenant_id,
        waba_id,
        phone_number_id,
        display_phone,
        display_name,
        mode,
        status,
        quality_rating,
        messaging_limit,
        card_missing,
        payment_status,
        created_at,
        updated_at,
        tenants (
          id,
          company_name,
          domain
        )
      `)
      .order('updated_at', { ascending: false });

    if (accountsError) {
      throw accountsError;
    }

    const accounts = (rawAccounts || []).map((acc: any) => ({
      id: acc.id,
      tenant_id: acc.tenant_id,
      company_name: acc.tenants?.company_name || 'Unknown Salon',
      domain: acc.tenants?.domain || null,
      waba_id: acc.waba_id,
      phone_number_id: acc.phone_number_id,
      display_phone: acc.display_phone,
      display_name: acc.display_name,
      mode: acc.mode,
      status: acc.status,
      quality_rating: acc.quality_rating || 'UNKNOWN',
      messaging_limit: acc.messaging_limit || 'TIER_250',
      card_missing: !!acc.card_missing,
      payment_status: acc.payment_status || 'unknown',
      created_at: acc.created_at,
      updated_at: acc.updated_at,
    }));

    // 2. Fetch daily usage records with tenant details
    let usageQuery = supabaseAdmin
      .from('whatsapp_usage_daily')
      .select(`
        id,
        tenant_id,
        date,
        inbound,
        outbound,
        outbound_template,
        by_category,
        created_at,
        updated_at,
        tenants (
          id,
          company_name
        )
      `)
      .order('date', { ascending: false })
      .limit(limit);

    if (tenantIdFilter) {
      usageQuery = usageQuery.eq('tenant_id', tenantIdFilter);
    }

    const { data: rawUsage, error: usageError } = await usageQuery;
    if (usageError) {
      throw usageError;
    }

    const dailyUsage = (rawUsage || []).map((row: any) => {
      const byCat = row.by_category || {};
      const service = Number(byCat.service || 0);
      const utility = Number(byCat.utility || 0);
      const marketing = Number(byCat.marketing || 0);
      const auth = Number(byCat.authentication || 0);
      const inbound = Number(row.inbound || 0);
      const outbound = Number(row.outbound || 0);
      const outboundTemplate = Number(row.outbound_template || 0);
      const totalMessages = inbound + outbound + outboundTemplate;

      return {
        id: row.id,
        tenant_id: row.tenant_id,
        company_name: row.tenants?.company_name || 'Unknown Salon',
        date: row.date,
        inbound,
        outbound,
        outbound_template: outboundTemplate,
        service,
        utility,
        marketing,
        authentication: auth,
        total_messages: totalMessages,
        created_at: row.created_at,
      };
    });

    // 3. Aggregate KPIs across all records
    const totalAccounts = accounts.length;
    const connectedAccounts = accounts.filter((a) => a.status === 'connected').length;
    const cardMissingAccounts = accounts.filter((a) => a.card_missing || a.payment_status === 'card_missing').length;

    let totalInbound = 0;
    let totalOutbound = 0;
    let totalOutboundTemplate = 0;
    let totalService = 0;
    let totalUtility = 0;
    let totalMarketing = 0;
    let totalAuth = 0;

    dailyUsage.forEach((u) => {
      totalInbound += u.inbound;
      totalOutbound += u.outbound;
      totalOutboundTemplate += u.outbound_template;
      totalService += u.service;
      totalUtility += u.utility;
      totalMarketing += u.marketing;
      totalAuth += u.authentication;
    });

    const kpis = {
      totalAccounts,
      connectedAccounts,
      cardMissingAccounts,
      totalInbound,
      totalOutbound,
      totalOutboundTemplate,
      totalMessages: totalInbound + totalOutbound + totalOutboundTemplate,
      byCategory: {
        service: totalService,
        utility: totalUtility,
        marketing: totalMarketing,
        authentication: totalAuth,
      },
    };

    // 4. Handle CSV Export
    if (format === 'csv') {
      const headerRow = 'Date,Tenant ID,Salon Name,Inbound,Outbound Freeform,Outbound Templates,Service (24h),Utility,Marketing,Authentication,Total Messages\n';
      const csvRows = dailyUsage.map((u) => {
        const safeSalon = `"${(u.company_name || '').replace(/"/g, '""')}"`;
        return `${u.date},${u.tenant_id},${safeSalon},${u.inbound},${u.outbound},${u.outbound_template},${u.service},${u.utility},${u.marketing},${u.authentication},${u.total_messages}`;
      });

      const csvContent = headerRow + csvRows.join('\n');
      const filename = `styleflo-whatsapp-usage-${new Date().toISOString().split('T')[0]}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default JSON Response
    return NextResponse.json({
      success: true,
      kpis,
      accounts,
      dailyUsage,
    });
  } catch (err: any) {
    console.error('[Superadmin WhatsApp Usage API] Error:', err);
    return NextResponse.json({ error: err.message || 'Error fetching WhatsApp usage' }, { status: 500 });
  }
}
