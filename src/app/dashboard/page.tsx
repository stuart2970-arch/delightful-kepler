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

  let billingData: any = { planTier: 'basic', entitlements: [], usage: { chunks: 0, messages: 0 } };
  let superadminData: any = null;

  try {
    // 2. Fetch User Profile & Tenant Mapping
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.tenant_id) {
      console.warn(`[Dashboard] No tenant provisioned for user ${user.id}. Waiting for trigger to fire.`);
      // In production, the trigger should have instantly created this.
      // We will show empty data rather than failing.
    } else {
      tenantId = profile.tenant_id;
      isSuperAdmin = !!profile.is_super_admin;
      
      const { data: tenant } = await supabase
        .from('tenants')
        .select('company_name, domain, business_address, postcode, plan_tier, is_rwg_enabled, rwg_business_name, rwg_street_address, rwg_city, rwg_postcode, rwg_phone, is_registered_business_address, booking_mode, booking_url, general_operating_hours, operating_hours_overrides, holiday_settings, twilio_shadow_number, trading_address_street, trading_address_city, trading_address_postcode, trading_address_phone, company_registration_number, registered_address_street, registered_address_city, registered_address_postcode, is_registered_company, registered_address_same_as_trading, rwg_address_same_as_trading')
        .eq('id', tenantId)
        .single();
      
      if (tenant) {
        tenantName = tenant.company_name;
        domain = tenant.domain || '';
        businessAddress = tenant.business_address || '';
        postcode = tenant.postcode || '';
        bookingMode = tenant.booking_mode || 'single_calendar';
        bookingUrl = tenant.booking_url || '';
        rwgConfig = {
          is_rwg_enabled: tenant.is_rwg_enabled || false,
          rwg_business_name: tenant.rwg_business_name || '',
          rwg_street_address: tenant.rwg_street_address || '',
          rwg_city: tenant.rwg_city || '',
          rwg_postcode: tenant.rwg_postcode || '',
          rwg_phone: tenant.rwg_phone || '',
          is_registered_business_address: tenant.is_registered_business_address || false,
        };
        tradingAddressStreet = tenant.trading_address_street || '';
        tradingAddressCity = tenant.trading_address_city || '';
        tradingAddressPostcode = tenant.trading_address_postcode || '';
        tradingAddressPhone = tenant.trading_address_phone || '';
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
      }

      // Check Google Connection Status
      const { data: googleIntegration } = await supabase
        .from('tenant_integrations')
        .select('account_email')
        .eq('tenant_id', tenantId)
        .eq('provider', 'google_calendar')
        .single();
      
      if (googleIntegration) {
        initialGoogleConnected = true;
        initialGoogleConnectedEmail = googleIntegration.account_email || null;
      }
    }

    // 3. Securely Fetch Dashboard Data using RLS
    // If user is super admin, we could bypass here or rely on RLS logic.
    // The DB Client is already running under the user's JWT. 
    // RLS in Postgres will handle filtering by tenant_id (or letting superadmin see all).
    
    // Check for Impersonation
    let isImpersonating = false;
    let queryClient = supabase;
    const resolvedParams = props.searchParams ? await props.searchParams : {};
    
    if (isSuperAdmin && resolvedParams.tenant_id && typeof resolvedParams.tenant_id === 'string') {
      tenantId = resolvedParams.tenant_id;
      isImpersonating = true;
      
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      queryClient = createClient(supabaseUrl, serviceRoleKey);
      
      // Override tenant mapping to fetch the impersonated tenant's data using the admin client
      const { data: impTenant } = await queryClient
        .from('tenants')
        .select('company_name, domain, business_address, postcode, plan_tier, is_rwg_enabled, rwg_business_name, rwg_street_address, rwg_city, rwg_postcode, rwg_phone, is_registered_business_address, booking_mode, booking_url, general_operating_hours, operating_hours_overrides, holiday_settings, twilio_shadow_number, trading_address_street, trading_address_city, trading_address_postcode, trading_address_phone, company_registration_number, registered_address_street, registered_address_city, registered_address_postcode, is_registered_company, registered_address_same_as_trading, rwg_address_same_as_trading')
        .eq('id', tenantId)
        .single();
        
      if (impTenant) {
        tenantName = impTenant.company_name;
        domain = impTenant.domain || '';
        businessAddress = impTenant.business_address || '';
        postcode = impTenant.postcode || '';
        bookingMode = impTenant.booking_mode || 'single_calendar';
        bookingUrl = impTenant.booking_url || '';
        rwgConfig = {
          is_rwg_enabled: impTenant.is_rwg_enabled || false,
          rwg_business_name: impTenant.rwg_business_name || '',
          rwg_street_address: impTenant.rwg_street_address || '',
          rwg_city: impTenant.rwg_city || '',
          rwg_postcode: impTenant.rwg_postcode || '',
          rwg_phone: impTenant.rwg_phone || '',
          is_registered_business_address: impTenant.is_registered_business_address || false,
        };
        tradingAddressStreet = impTenant.trading_address_street || '';
        tradingAddressCity = impTenant.trading_address_city || '';
        tradingAddressPostcode = impTenant.trading_address_postcode || '';
        tradingAddressPhone = impTenant.trading_address_phone || '';
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
      }

      // Check Google Connection Status for Impersonated Tenant
      const { data: googleIntegration } = await queryClient
        .from('tenant_integrations')
        .select('account_email')
        .eq('tenant_id', tenantId)
        .eq('provider', 'google_calendar')
        .single();
      
      if (googleIntegration) {
        initialGoogleConnected = true;
        initialGoogleConnectedEmail = googleIntegration.account_email || null;
      } else {
        initialGoogleConnected = false;
        initialGoogleConnectedEmail = null;
      }
    }

    // Super admins should only see data for the tenant they are currently viewing (their own or impersonated).
    let queryFilter = { key: 'tenant_id', value: tenantId };

    // Chatbots
    let botsQuery = queryClient.from('chatbots').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) botsQuery = botsQuery.eq(queryFilter.key, queryFilter.value);
    const { data: bots } = await botsQuery;
    if (bots) chatbots = bots;

    // Conversations
    let convsQuery = queryClient.from('conversations').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) convsQuery = convsQuery.eq(queryFilter.key, queryFilter.value);
    const { data: convs } = await convsQuery;
    if (convs) conversations = convs;

    // Services
    let servicesQuery = queryClient.from('services').select('*, staff_services(*)').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) servicesQuery = servicesQuery.eq(queryFilter.key, queryFilter.value);
    const { data: srvs } = await servicesQuery;
    services = srvs || [];

    // Staff
    let staffQuery = queryClient.from('staff').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) staffQuery = staffQuery.eq(queryFilter.key, queryFilter.value);
    const { data: stff } = await staffQuery;
    staff = stff || [];

    // Appointments
    let appointmentsQuery = queryClient.from('appointments').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) appointmentsQuery = appointmentsQuery.eq(queryFilter.key, queryFilter.value);
    const { data: appts } = await appointmentsQuery;
    appointments = appts || [];

    // Metrics (Chunks) - document_chunks doesn't have tenant_id, so we filter by chatbot_ids
    let chunksCount = 0;
    const chatbotIds = chatbots.map((b: any) => b.id);
    if (chatbotIds.length > 0) {
      const { count } = await queryClient
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .in('chatbot_id', chatbotIds);
      chunksCount = count || 0;
    }

    // Metrics (Messages)
    let msgsQuery = queryClient.from('messages').select('*', { count: 'exact', head: true });
    if (queryFilter && queryFilter.value) msgsQuery = msgsQuery.eq(queryFilter.key, queryFilter.value);
    const { count: msgsCount } = await msgsQuery;

    metrics = {
      chatbotsCount: chatbots.length,
      chunksCount: chunksCount || 0,
      sessionsCount: conversations.length,
      messagesCount: msgsCount || 0,
    };
    
    // 4. Fetch Billing Data
    billingData.usage.chunks = chunksCount || 0;

    if (tenantId) {
      const { data: tenantData } = await queryClient.from('tenants').select('plan_tier').eq('id', tenantId).single();
      if (tenantData) {
        billingData.planTier = tenantData.plan_tier;
        const { data: entitlements } = await queryClient
          .from('tier_entitlements')
          .select('feature_id, limit_value, features(name, is_metered)')
          .eq('tier_id', tenantData.plan_tier);
        if (entitlements) billingData.entitlements = entitlements;
      }
      
      const firstDay = new Date();
      firstDay.setDate(1);
      firstDay.setHours(0, 0, 0, 0);

      // Current user usage
      const { data: usageRows } = await queryClient
        .from('usage_ledger')
        .select('quantity, feature_id')
        .eq('tenant_id', tenantId)
        .gte('recorded_at', firstDay.toISOString());
      
      if (usageRows) {
        billingData.usage.messages = usageRows
          .filter(r => r.feature_id === 'message_allowance')
          .reduce((sum, r) => sum + r.quantity, 0);
      }
    }

    if (isSuperAdmin && !isImpersonating) {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

      const { data: allTenantsList } = await adminSupabase.from('tenants').select('id, company_name, plan_tier, slug');
      
      const firstDay = new Date();
      firstDay.setDate(1);
      firstDay.setHours(0, 0, 0, 0);
      const { data: allUsage } = await adminSupabase
        .from('usage_ledger')
        .select('quantity, feature_id, tenant_id, actual_cost')
        .gte('recorded_at', firstDay.toISOString());

      superadminData = {
        tenants: allTenantsList || [],
        usage: allUsage || []
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
        isImpersonating={isSuperAdmin && typeof (props.searchParams ? await props.searchParams : {}).tenant_id === 'string'}
      />
    </main>
  );
}
