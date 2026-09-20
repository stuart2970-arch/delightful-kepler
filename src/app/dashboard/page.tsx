import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import DashboardClient from '@/components/DashboardClient';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Helper to create server-side Supabase client (Always uses Anon Key + User Token)
async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.SUPABASE_URL || process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createServerClient(supabaseUrl, key, {
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

export default async function DashboardPage(props: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : {};
  const initialTab = typeof resolvedSearchParams.tab === 'string' ? resolvedSearchParams.tab : undefined;
  const supabase = await createSupabaseServerClient();
  
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // 1. Enforce Authentication Redirect
  if (authError || !user) {
    redirect('/login');
  }

  const userEmail = user.email || '';
  const userName = user.user_metadata?.full_name || user.user_metadata?.name || 'User';

  let tenantId = '';
  let tenantName = 'My Workspace';
  let isSuperAdmin = false;
  let domain = '';
  let businessAddress = '';
  let postcode = '';
  let bookingMode = 'single_calendar';
  let bookingUrl = '';
  let generalOperatingHours = {};
  let operatingHoursOverrides = [];
  let holidaySettings = {};
  let globalVoiceDisclaimer = '';
  
  let initialGoogleConnected = false;
  let initialGoogleConnectedEmail = null;
  let initialTwilioShadowNumber = null;
  let initialTwilioMobileNumber = null;
  
  let chatbots: any[] = [];
  let conversations: any[] = [];
  let services: any[] = [];
  let staff: any[] = [];
  let appointments: any[] = [];
  let metrics = {
    chatbotsCount: 0,
    chunksCount: 0,
    sessionsCount: 0,
    messagesCount: 0,
  };
  let rwgConfig: any = {
    is_rwg_enabled: false,
    rwg_business_name: '',
    rwg_street_address: '',
    rwg_city: '',
    rwg_postcode: '',
    rwg_phone: '',
    is_registered_business_address: false
  };
  let tradingAddressStreet = '';
  let tradingAddressCity = '';
  let tradingAddressPostcode = '';
  let tradingAddressPhone = '';
  let companyRegistrationNumber = '';
  let registeredAddressStreet = '';
  let registeredAddressCity = '';
  let registeredAddressPostcode = '';
  let isRegisteredCompany = false;
  let registeredAddressSameAsTrading = true;
  let rwgAddressSameAsTrading = true;
  let userRole: 'owner' | 'admin' | 'member' = 'owner';
  let billingData: any = {
    planTier: 'base_tier',
    entitlements: [],
    usage: { chunks: 0, messages: 0 },
    addons: [],
    channelFlags: { has_landline: false, has_mobile: false, has_whatsapp: false },
    rolloverUsage: { voice_minutes_allocated: 0, voice_minutes_consumed: 0, voice_minutes_remaining: 0, sms_allocated: 0, sms_consumed: 0, sms_remaining: 0 },
    thresholds: [],
  };
  let superadminData: any = null;

  try {
    // 2. Fetch User Profile & Tenant Mapping (using maybeSingle to prevent PGRST116 errors)
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, is_super_admin, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      console.warn(`[Dashboard] No tenant provisioned for user ${user.id}.`);
    } else {
      tenantId = profile.tenant_id;
      isSuperAdmin = !!profile.is_super_admin;
      userRole = (profile.role as 'owner' | 'admin' | 'member') || 'owner';
      
      const { data: tenant } = await supabase
        .from('tenants')
        .select('company_name, domain, business_address, postcode, plan_tier, is_rwg_enabled, rwg_business_name, rwg_street_address, rwg_city, rwg_postcode, rwg_phone, is_registered_business_address, booking_mode, booking_url, general_operating_hours, operating_hours_overrides, holiday_settings, twilio_shadow_number, twilio_mobile_number, trading_address_street, trading_address_city, trading_address_postcode, trading_address_phone, company_registration_number, registered_address_street, registered_address_city, registered_address_postcode, is_registered_company, registered_address_same_as_trading, rwg_address_same_as_trading')
        .eq('id', tenantId)
        .maybeSingle();
      
      if (tenant) {
        tenantName = tenant.company_name;
        domain = tenant.domain || '';
        businessAddress = tenant.business_address || '';
        postcode = tenant.postcode || '';
        bookingMode = tenant.booking_mode || 'single_calendar';
        bookingUrl = tenant.booking_url || '';
        tradingAddressStreet = tenant.trading_address_street || tenant.business_address || '';
        tradingAddressCity = tenant.trading_address_city || '';
        tradingAddressPostcode = tenant.trading_address_postcode || tenant.postcode || '';
        tradingAddressPhone = tenant.trading_address_phone || tenant.twilio_shadow_number || '';
        rwgConfig = {
          is_rwg_enabled: tenant.is_rwg_enabled || false,
          rwg_business_name: tenant.rwg_business_name || tenant.company_name || '',
          rwg_street_address: tenant.rwg_street_address || tradingAddressStreet,
          rwg_city: tenant.rwg_city || tradingAddressCity,
          rwg_postcode: tenant.rwg_postcode || tradingAddressPostcode,
          rwg_phone: tenant.rwg_phone || tradingAddressPhone,
          is_registered_business_address: tenant.is_registered_business_address || false,
        };
        companyRegistrationNumber = tenant.company_registration_number || '';
        registeredAddressStreet = tenant.registered_address_street || '';
        registeredAddressCity = tenant.registered_address_city || '';
        registeredAddressPostcode = tenant.registered_address_postcode || '';
        isRegisteredCompany = tenant.is_registered_company || false;
        registeredAddressSameAsTrading = tenant.registered_address_same_as_trading !== false;
        rwgAddressSameAsTrading = tenant.rwg_address_same_as_trading !== false;
        generalOperatingHours = tenant.general_operating_hours || {};
        operatingHoursOverrides = tenant.operating_hours_overrides || [];
        holidaySettings = tenant.holiday_settings || {};
        initialTwilioShadowNumber = tenant.twilio_shadow_number || null;
        initialTwilioMobileNumber = tenant.twilio_mobile_number || null;
      }

      // Check Google Connection Status
      const { data: googleIntegration } = await supabase
        .from('tenant_integrations')
        .select('account_email')
        .eq('tenant_id', tenantId)
        .eq('provider', 'google_calendar')
        .maybeSingle();
      
      if (googleIntegration) {
        initialGoogleConnected = true;
        initialGoogleConnectedEmail = googleIntegration.account_email || null;
      }
    }

    // 3. Securely Fetch Dashboard Data using RLS
    let isImpersonating = false;
    let queryClient = supabase;
    const resolvedParams = props.searchParams ? await props.searchParams : {};
    const initialTab = typeof resolvedParams.tab === 'string' ? resolvedParams.tab : undefined;
    
    if (isSuperAdmin && resolvedParams.tenant_id && typeof resolvedParams.tenant_id === 'string') {
      tenantId = resolvedParams.tenant_id;
      isImpersonating = true;
      
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      queryClient = createClient(supabaseUrl, serviceRoleKey);
      
      // Override tenant mapping to fetch impersonated tenant data
      const { data: impTenant } = await queryClient
        .from('tenants')
        .select('company_name, domain, business_address, postcode, plan_tier, is_rwg_enabled, rwg_business_name, rwg_street_address, rwg_city, rwg_postcode, rwg_phone, is_registered_business_address, booking_mode, booking_url, general_operating_hours, operating_hours_overrides, holiday_settings, twilio_shadow_number, twilio_mobile_number, trading_address_street, trading_address_city, trading_address_postcode, trading_address_phone, company_registration_number, registered_address_street, registered_address_city, registered_address_postcode, is_registered_company, registered_address_same_as_trading, rwg_address_same_as_trading')
        .eq('id', tenantId)
        .maybeSingle();
        
      if (impTenant) {
        tenantName = impTenant.company_name;
        domain = impTenant.domain || '';
        businessAddress = impTenant.business_address || '';
        postcode = impTenant.postcode || '';
        bookingMode = impTenant.booking_mode || 'single_calendar';
        bookingUrl = impTenant.booking_url || '';
        tradingAddressStreet = impTenant.trading_address_street || impTenant.business_address || '';
        tradingAddressCity = impTenant.trading_address_city || '';
        tradingAddressPostcode = impTenant.trading_address_postcode || impTenant.postcode || '';
        tradingAddressPhone = impTenant.trading_address_phone || impTenant.twilio_shadow_number || '';
        rwgConfig = {
          is_rwg_enabled: impTenant.is_rwg_enabled || false,
          rwg_business_name: impTenant.rwg_business_name || impTenant.company_name || '',
          rwg_street_address: impTenant.rwg_street_address || tradingAddressStreet,
          rwg_city: impTenant.rwg_city || tradingAddressCity,
          rwg_postcode: impTenant.rwg_postcode || tradingAddressPostcode,
          rwg_phone: impTenant.rwg_phone || tradingAddressPhone,
          is_registered_business_address: impTenant.is_registered_business_address || false,
        };
        companyRegistrationNumber = impTenant.company_registration_number || '';
        registeredAddressStreet = impTenant.registered_address_street || '';
        registeredAddressCity = impTenant.registered_address_city || '';
        registeredAddressPostcode = impTenant.registered_address_postcode || '';
        isRegisteredCompany = impTenant.is_registered_company || false;
        registeredAddressSameAsTrading = impTenant.registered_address_same_as_trading !== false;
        rwgAddressSameAsTrading = impTenant.rwg_address_same_as_trading !== false;
        generalOperatingHours = impTenant.general_operating_hours || {};
        operatingHoursOverrides = impTenant.operating_hours_overrides || [];
        holidaySettings = impTenant.holiday_settings || {};
        initialTwilioShadowNumber = impTenant.twilio_shadow_number || null;
        initialTwilioMobileNumber = impTenant.twilio_mobile_number || null;
      }

      // Check Google Connection Status for Impersonated Tenant
      const { data: googleIntegration } = await queryClient
        .from('tenant_integrations')
        .select('account_email')
        .eq('tenant_id', tenantId)
        .eq('provider', 'google_calendar')
        .maybeSingle();
      
      if (googleIntegration) {
        initialGoogleConnected = true;
        initialGoogleConnectedEmail = googleIntegration.account_email || null;
      } else {
        initialGoogleConnected = false;
        initialGoogleConnectedEmail = null;
      }
    }

    let queryFilter = tenantId ? { key: 'tenant_id', value: tenantId } : null;

    // Chatbots
    if (queryFilter && queryFilter.value) {
      const { data: bots } = await queryClient.from('chatbots').select('*').eq(queryFilter.key, queryFilter.value).order('created_at', { ascending: false });
      if (bots) chatbots = bots;

      const { data: convs } = await queryClient.from('conversations').select('*').eq(queryFilter.key, queryFilter.value).order('created_at', { ascending: false });
      if (convs) conversations = convs;

      const { data: srvs } = await queryClient.from('services').select('*, staff_services(*)').eq(queryFilter.key, queryFilter.value).order('created_at', { ascending: false });
      services = srvs || [];

      const { data: stff } = await queryClient.from('staff').select('*').eq(queryFilter.key, queryFilter.value).order('created_at', { ascending: false });
      staff = stff || [];

      const { data: appts } = await queryClient.from('appointments').select('*').eq(queryFilter.key, queryFilter.value).order('created_at', { ascending: false });
      appointments = appts || [];
    }

    // Metrics (Chunks)
    let chunksCount = 0;
    const chatbotIds = (chatbots || []).map((b: any) => b.id);
    if (chatbotIds.length > 0) {
      const { count } = await queryClient
        .from('document_chunks')
        .select('*', { count: 'estimated', head: true })
        .in('chatbot_id', chatbotIds);
      chunksCount = count || 0;
    }

    // Metrics (Messages)
    let msgsCount = 0;
    if (queryFilter && queryFilter.value) {
      const { count } = await queryClient.from('messages').select('*', { count: 'estimated', head: true }).eq(queryFilter.key, queryFilter.value);
      msgsCount = count || 0;
    }

    metrics = {
      chatbotsCount: chatbots.length,
      chunksCount: chunksCount || 0,
      sessionsCount: conversations.length,
      messagesCount: msgsCount || 0,
    };
    
    // 4. Fetch Billing Data
    billingData.usage.chunks = chunksCount || 0;

    if (tenantId) {
      const { data: tenantData } = await queryClient.from('tenants').select('plan_tier, has_landline, has_mobile, has_whatsapp').eq('id', tenantId).maybeSingle();
      if (tenantData) {
        billingData.planTier = tenantData.plan_tier;
        billingData.channelFlags = {
          has_landline: tenantData.has_landline ?? false,
          has_mobile: tenantData.has_mobile ?? false,
          has_whatsapp: tenantData.has_whatsapp ?? false,
        };
        const { data: entitlements } = await queryClient
          .from('tier_entitlements')
          .select('feature_id, limit_value, features(name, is_metered)')
          .eq('tier_id', tenantData.plan_tier);
        if (entitlements) billingData.entitlements = entitlements;
      }
      
      const firstDay = new Date();
      firstDay.setDate(1);
      firstDay.setHours(0, 0, 0, 0);

      // Current user usage (standard monthly)
      const { data: usageRows } = await queryClient
        .from('usage_ledger')
        .select('quantity, feature_id')
        .eq('tenant_id', tenantId)
        .gte('recorded_at', firstDay.toISOString());
      
      if (usageRows) {
        billingData.usage.messages = usageRows
          .filter(r => r.feature_id === 'message_allowance')
          .reduce((sum, r) => sum + (r.quantity || 0), 0);
      }

      // Fetch active add-ons with catalog details
      const { data: activeAddons } = await queryClient
        .from('tenant_active_addons')
        .select(`
          id,
          addon_catalog_id,
          is_active,
          activated_at,
          addon_catalog (
            name,
            category,
            monthly_price_pence,
            included_voice_minutes,
            included_sms,
            included_messages,
            included_data_chunks
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true);

      if (activeAddons) {
        billingData.addons = activeAddons.map((a: any) => ({
          id: a.id,
          addon_catalog_id: a.addon_catalog_id,
          name: a.addon_catalog?.name || '',
          category: a.addon_catalog?.category || '',
          monthly_price_pence: a.addon_catalog?.monthly_price_pence || 0,
          included_voice_minutes: a.addon_catalog?.included_voice_minutes || 0,
          included_sms: a.addon_catalog?.included_sms || 0,
          included_messages: a.addon_catalog?.included_messages || 0,
          included_data_chunks: a.addon_catalog?.included_data_chunks || 0,
          is_active: a.is_active,
          activated_at: a.activated_at,
        }));
      }

      // Fetch 3-month rolling usage for voice/SMS
      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const { data: allocations } = await queryClient
        .from('usage_ledger')
        .select('feature_id, quantity')
        .eq('tenant_id', tenantId)
        .eq('usage_type', 'allocation')
        .in('feature_id', ['voice_minutes', 'sms_messages'])
        .gte('expires_at', now.toISOString())
        .gte('billing_period_start', threeMonthsAgo.toISOString());

      const { data: consumptions } = await queryClient
        .from('usage_ledger')
        .select('feature_id, quantity')
        .eq('tenant_id', tenantId)
        .eq('usage_type', 'consumption')
        .in('feature_id', ['voice_minutes', 'sms_messages'])
        .gte('recorded_at', threeMonthsAgo.toISOString());

      const sumFeature = (rows: any[] | null, fid: string) =>
        (rows || []).filter(r => r.feature_id === fid).reduce((s, r) => s + (r.quantity || 0), 0);

      billingData.rolloverUsage = {
        voice_minutes_allocated: sumFeature(allocations, 'voice_minutes'),
        voice_minutes_consumed: sumFeature(consumptions, 'voice_minutes'),
        voice_minutes_remaining: Math.max(0, sumFeature(allocations, 'voice_minutes') - sumFeature(consumptions, 'voice_minutes')),
        sms_allocated: sumFeature(allocations, 'sms_messages'),
        sms_consumed: sumFeature(consumptions, 'sms_messages'),
        sms_remaining: Math.max(0, sumFeature(allocations, 'sms_messages') - sumFeature(consumptions, 'sms_messages')),
      };

      // Compute 85% capacity thresholds
      const thresholds: any[] = [];
      const featureUpgradeMap: Record<string, { category: string; addonId: string; addonName: string; pricePence: number }> = {
        knowledge_data_chunks: { category: 'data_pack', addonId: 'data_pack_500', addonName: '500 Knowledge Base Chunks', pricePence: 999 },
        voice_minutes: { category: 'voice_pack', addonId: 'voice_pack_20', addonName: '20 Voice Minutes Pack', pricePence: 1500 },
        sms_messages: { category: 'sms_pack', addonId: 'sms_pack_100', addonName: '100 SMS Pack', pricePence: 599 },
        message_allowance: { category: 'data_pack', addonId: 'data_pack_500', addonName: '500 Knowledge Base Chunks', pricePence: 999 },
      };

      for (const ent of (billingData.entitlements || [])) {
        if (!ent.limit_value || ent.limit_value <= 0) continue;
        let currentUsage = 0;

        if (ent.feature_id === 'knowledge_data_chunks') {
          currentUsage = chunksCount || 0;
        } else if (ent.feature_id === 'message_allowance') {
          currentUsage = billingData.usage.messages || 0;
        } else if (ent.feature_id === 'voice_minutes') {
          currentUsage = billingData.rolloverUsage.voice_minutes_consumed || 0;
        } else if (ent.feature_id === 'sms_messages') {
          currentUsage = billingData.rolloverUsage.sms_consumed || 0;
        }

        const percentUsed = Math.round((currentUsage / ent.limit_value) * 100);
        if (percentUsed >= 85) {
          const upgrade = featureUpgradeMap[ent.feature_id];
          if (upgrade) {
            thresholds.push({
              featureId: ent.feature_id,
              featureName: ent.features?.name || ent.feature_id,
              percentUsed,
              currentUsage,
              limit: ent.limit_value,
              upgradeCategory: upgrade.category,
              upgradeAddonId: upgrade.addonId,
              upgradeAddonName: upgrade.addonName,
              upgradePricePence: upgrade.pricePence,
            });
          }
        }
      }
      billingData.thresholds = thresholds;
    }

    if (isSuperAdmin && !isImpersonating) {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

      let allTenantsList: any[] = [];
      let allUsage: any[] = [];
      let globalChatMessages = 0;
      let monthlyChatMessages = 0;
      let globalChatConversations = 0;
      let monthlyChatConversations = 0;
      let globalVoiceCalls = 0;
      let monthlyVoiceCalls = 0;
      let totalVoiceMinutes = 0;
      let monthlyVoiceMinutes = 0;

      const firstDay = new Date();
      firstDay.setDate(1);
      firstDay.setHours(0, 0, 0, 0);

      try {
        const [
          tenantsRes,
          usageRes,
          globalMsgsRes,
          monthlyMsgsRes,
          globalConvsRes,
          monthlyConvsRes,
          globalVoiceRes,
          monthlyVoiceRes,
          allTimeVoiceUsageRes
        ] = await Promise.all([
          adminSupabase.from('tenants').select('id, company_name, plan_tier, slug').order('created_at', { ascending: false }),
          adminSupabase.from('usage_ledger').select('quantity, feature_id, tenant_id, actual_cost').gte('recorded_at', firstDay.toISOString()).limit(2000),
          adminSupabase.from('messages').select('*', { count: 'estimated', head: true }),
          adminSupabase.from('messages').select('*', { count: 'estimated', head: true }).gte('created_at', firstDay.toISOString()),
          adminSupabase.from('conversations').select('*', { count: 'estimated', head: true }).eq('is_voice_call', false),
          adminSupabase.from('conversations').select('*', { count: 'estimated', head: true }).eq('is_voice_call', false).gte('created_at', firstDay.toISOString()),
          adminSupabase.from('conversations').select('*', { count: 'estimated', head: true }).eq('is_voice_call', true),
          adminSupabase.from('conversations').select('*', { count: 'estimated', head: true }).eq('is_voice_call', true).gte('created_at', firstDay.toISOString()),
          adminSupabase.from('usage_ledger').select('quantity').eq('feature_id', 'vapi_voice_minutes').limit(1000)
        ]);

        allTenantsList = tenantsRes.data || [];
        allUsage = usageRes.data || [];
        globalChatMessages = globalMsgsRes.count || 0;
        monthlyChatMessages = monthlyMsgsRes.count || 0;
        globalChatConversations = globalConvsRes.count || 0;
        monthlyChatConversations = monthlyConvsRes.count || 0;
        globalVoiceCalls = globalVoiceRes.count || 0;
        monthlyVoiceCalls = monthlyVoiceRes.count || 0;
        totalVoiceMinutes = (allTimeVoiceUsageRes.data || []).reduce((sum: number, u: any) => sum + (u.quantity || 0), 0);
        monthlyVoiceMinutes = allUsage
          .filter((u: any) => u.feature_id === 'vapi_voice_minutes')
          .reduce((sum: number, u: any) => sum + (u.quantity || 0), 0);
      } catch (err) {
        console.error('[Dashboard] Superadmin metrics query error:', err);
      }

      superadminData = {
        tenants: allTenantsList || [],
        usage: allUsage || [],
        totalChatMessages: globalChatMessages,
        monthlyChatMessages,
        totalChatConversations: globalChatConversations,
        monthlyChatConversations,
        totalVoiceCalls: globalVoiceCalls,
        monthlyVoiceCalls,
        totalVoiceMinutes,
        monthlyVoiceMinutes,
      };
    }

  } catch (err) {
    console.error('[Dashboard] Error querying secure database:', err);
  }

  return (
    <main className="min-h-0 bg-[var(--awb-color3)] text-[var(--awb-color7)] p-4 md:p-8 font-sans max-w-[1200px] mx-auto w-full">
      <DashboardClient
        isDevMode={false}
        tenantId={tenantId}
        tenantName={tenantName}
        userEmail={userEmail}
        userName={userName}
        initialChatbots={chatbots}
        initialConversations={conversations}
        initialServices={services}
        initialStaff={staff}
        initialAppointments={appointments}
        initialMetrics={metrics}
        isSuperAdmin={isSuperAdmin}
        initialDomain={domain}
        initialBusinessAddress={businessAddress}
        initialPostcode={postcode}
        initialTradingAddressStreet={tradingAddressStreet}
        initialTradingAddressCity={tradingAddressCity}
        initialTradingAddressPostcode={tradingAddressPostcode}
        initialTradingAddressPhone={tradingAddressPhone}
        initialCompanyRegistrationNumber={companyRegistrationNumber}
        initialRegisteredAddressStreet={registeredAddressStreet}
        initialRegisteredAddressCity={registeredAddressCity}
        initialRegisteredAddressPostcode={registeredAddressPostcode}
        initialIsRegisteredCompany={isRegisteredCompany}
        initialRegisteredAddressSameAsTrading={registeredAddressSameAsTrading}
        initialRwgAddressSameAsTrading={rwgAddressSameAsTrading}
        initialTwilioShadowNumber={initialTwilioShadowNumber}
        initialTwilioMobileNumber={initialTwilioMobileNumber}
        initialRwgConfig={rwgConfig}
        initialBookingMode={bookingMode}
        initialBookingUrl={bookingUrl}
        initialGeneralOperatingHours={generalOperatingHours}
        initialOperatingHoursOverrides={operatingHoursOverrides}
        initialHolidaySettings={holidaySettings}
        initialGoogleConnected={initialGoogleConnected}
        initialGoogleConnectedEmail={initialGoogleConnectedEmail}
        initialGlobalVoiceDisclaimer={globalVoiceDisclaimer}
        billingData={billingData}
        superadminData={superadminData}
        role={userRole}
        initialTab={initialTab}
        isImpersonating={isSuperAdmin && typeof resolvedSearchParams.tenant_id === 'string'}
      />
    </main>
  );
}
