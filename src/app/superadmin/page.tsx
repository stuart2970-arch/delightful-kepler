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

  // Check if superadmin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_super_admin) {
    redirect('/dashboard');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const { createClient } = await import('@supabase/supabase-js');
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

  // Fetch global platform settings using admin client
  const { data: globalBot } = await adminSupabase
    .from('chatbots')
    .select('configuration_json')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .maybeSingle();

  let initialGlobalBrandingHtml = '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';
  let initialGlobalTrackingUrl = 'https://styleflo.ai';
  let initialGlobalVoiceDisclaimer = '';

  if (globalBot?.configuration_json) {
    if (globalBot.configuration_json.branding_html !== undefined) initialGlobalBrandingHtml = globalBot.configuration_json.branding_html;
    if (globalBot.configuration_json.branding_url !== undefined) initialGlobalTrackingUrl = globalBot.configuration_json.branding_url;
    if (globalBot.configuration_json.global_voice_disclaimer !== undefined) initialGlobalVoiceDisclaimer = globalBot.configuration_json.global_voice_disclaimer;
  }

  // Fetch all tenants using admin client
  const { data: tenants } = await adminSupabase
    .from('tenants')
    .select('id, company_name, plan_tier, created_at, slug')
    .order('created_at', { ascending: false });

  // Fetch all chatbots with their tenant_id
  const { data: allBots } = await adminSupabase
    .from('chatbots')
    .select('id, tenant_id');

  // Fetch document chunks for crawls count
  const { data: allChunks } = await adminSupabase
    .from('document_chunks')
    .select('chatbot_id');

  // Fetch conversations and messages for token/messages count
  const { data: allConvs } = await adminSupabase
    .from('conversations')
    .select('id, chatbot_id');

  const convIds = (allConvs || []).map(c => c.id);
  const { data: allMsgs } = convIds.length > 0
    ? await adminSupabase.from('messages').select('conversation_id')
    : { data: [] };

  // Fetch usage logs
  const { data: allUsage } = await adminSupabase
    .from('usage_ledger')
    .select('quantity, feature_id, tenant_id');

  // Map chatbot IDs to tenants
  const botTenantMap = new Map<string, string>();
  (allBots || []).forEach(b => {
    if (b.tenant_id) botTenantMap.set(b.id, b.tenant_id);
  });

  // Map conversation IDs to tenants
  const convTenantMap = new Map<string, string>();
  (allConvs || []).forEach(c => {
    const tenantId = botTenantMap.get(c.chatbot_id);
    if (tenantId) convTenantMap.set(c.id, tenantId);
  });

  // Aggregate stats per tenant
  const tenantStats = (tenants || []).map(t => {
    const tenantUsage = (allUsage || []).filter(u => u.tenant_id === t.id);
    const ledgerMessages = tenantUsage.filter(u => u.feature_id === 'message_allowance').reduce((sum, u) => sum + Number(u.quantity), 0);
    const ledgerCrawls = tenantUsage.filter(u => u.feature_id === 'knowledge_data_chunks').reduce((sum, u) => sum + Number(u.quantity), 0);

    const dbCrawls = (allChunks || []).filter(c => botTenantMap.get(c.chatbot_id) === t.id).length;
    const dbMessages = (allMsgs || []).filter(m => convTenantMap.get(m.conversation_id) === t.id).length;

    return {
      id: t.id,
      company_name: t.company_name,
      plan_tier: t.plan_tier,
      created_at: t.created_at,
      slug: t.slug,
      messagesCount: Math.max(ledgerMessages, dbMessages),
      crawlsCount: Math.max(ledgerCrawls, dbCrawls)
    };
  });

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <SuperadminClient 
        tenants={tenantStats} 
        initialGlobalBrandingHtml={initialGlobalBrandingHtml}
        initialGlobalTrackingUrl={initialGlobalTrackingUrl}
        initialGlobalVoiceDisclaimer={initialGlobalVoiceDisclaimer}
      />
    </main>
  );
}
