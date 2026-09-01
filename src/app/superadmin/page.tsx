import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import SuperadminClient from '@/components/superadmin/SuperadminClient';

export const dynamic = 'force-dynamic';

async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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

export default async function SuperadminPage() {
  const supabase = await createSupabaseServerClient();
  
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[SuperadminPage] Missing service role key or Supabase URL');
    redirect('/dashboard');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Check if superadmin using admin client to bypass any RLS locks
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !profile.is_super_admin) {
    redirect('/dashboard');
  }

  let globalBot: any = null;
  let fetchedTenants: any[] = [];
  let allBots: any[] = [];
  let allChunks: any[] = [];
  let allConvs: any[] = [];
  let allMsgs: any[] = [];
  let allUsage: any[] = [];

  try {
    const [globalBotRes, tenantsRes, botsRes, chunksRes, convsRes, usageRes] = await Promise.all([
      adminSupabase.from('chatbots').select('configuration_json').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle(),
      adminSupabase.from('tenants').select('id, company_name, plan_tier, is_active, subscription_status, created_at, slug').order('created_at', { ascending: false }),
      adminSupabase.from('chatbots').select('id, tenant_id'),
      adminSupabase.from('document_chunks').select('chatbot_id').limit(2000),
      adminSupabase.from('conversations').select('id, chatbot_id').limit(2000),
      adminSupabase.from('usage_ledger').select('quantity, feature_id, tenant_id').limit(2000),
    ]);

    globalBot = globalBotRes?.data || null;
    fetchedTenants = tenantsRes?.data || [];
    allBots = botsRes?.data || [];
    allChunks = chunksRes?.data || [];
    allConvs = convsRes?.data || [];
    allUsage = usageRes?.data || [];

    if (allConvs.length > 0) {
      const msgsRes = await adminSupabase.from('messages').select('conversation_id').limit(5000);
      allMsgs = msgsRes?.data || [];
    }
  } catch (err) {
    console.error('[SuperadminPage] Error fetching superadmin data:', err);
  }

  let initialGlobalBrandingHtml = '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';
  let initialGlobalTrackingUrl = 'https://styleflo.ai';
  let initialGlobalVoiceDisclaimer = '';
  let initialGlobalGeminiModel = 'gemini-2.5-flash';

  if (globalBot?.configuration_json) {
    if (globalBot.configuration_json.branding_html !== undefined) initialGlobalBrandingHtml = globalBot.configuration_json.branding_html;
    if (globalBot.configuration_json.branding_url !== undefined) initialGlobalTrackingUrl = globalBot.configuration_json.branding_url;
    if (globalBot.configuration_json.global_voice_disclaimer !== undefined) initialGlobalVoiceDisclaimer = globalBot.configuration_json.global_voice_disclaimer;
    if (globalBot.configuration_json.default_gemini_model !== undefined) initialGlobalGeminiModel = globalBot.configuration_json.default_gemini_model;
  }

  // Map chatbot IDs to tenants
  const botTenantMap = new Map<string, string>();
  (allBots || []).forEach(b => {
    if (b && b.id && b.tenant_id) botTenantMap.set(b.id, b.tenant_id);
  });

  // Map conversation IDs to tenants
  const convTenantMap = new Map<string, string>();
  (allConvs || []).forEach(c => {
    if (c && c.id && c.chatbot_id) {
      const tenantId = botTenantMap.get(c.chatbot_id);
      if (tenantId) convTenantMap.set(c.id, tenantId);
    }
  });

  // Aggregate stats per tenant
  const tenantStats = (fetchedTenants || []).map(t => {
    if (!t) return null;
    const tenantUsage = (allUsage || []).filter(u => u && u.tenant_id === t.id);
    const ledgerMessages = tenantUsage.filter(u => u.feature_id === 'message_allowance').reduce((sum, u) => sum + Number(u.quantity || 0), 0);
    const ledgerCrawls = tenantUsage.filter(u => u.feature_id === 'knowledge_data_chunks').reduce((sum, u) => sum + Number(u.quantity || 0), 0);

    const dbCrawls = (allChunks || []).filter(c => c && botTenantMap.get(c.chatbot_id) === t.id).length;
    const dbMessages = (allMsgs || []).filter(m => m && convTenantMap.get(m.conversation_id) === t.id).length;

    return {
      id: t.id || '',
      company_name: t.company_name || 'Unnamed Business',
      plan_tier: t.plan_tier || 'free',
      is_active: t.is_active !== false,
      subscription_status: t.subscription_status || 'active',
      created_at: t.created_at || new Date().toISOString(),
      slug: t.slug || '',
      messagesCount: Math.max(ledgerMessages, dbMessages),
      crawlsCount: Math.max(ledgerCrawls, dbCrawls)
    };
  }).filter(Boolean);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <SuperadminClient 
        tenants={tenantStats as any[]} 
        initialGlobalBrandingHtml={initialGlobalBrandingHtml}
        initialGlobalTrackingUrl={initialGlobalTrackingUrl}
        initialGlobalVoiceDisclaimer={initialGlobalVoiceDisclaimer}
        initialGlobalGeminiModel={initialGlobalGeminiModel}
        initialFloBotConfig={globalBot?.configuration_json?.flobot_config || null}
      />
    </main>
  );
}
