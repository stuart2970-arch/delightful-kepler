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

  // Fetch global platform settings
  const { data: globalBot } = await supabase
    .from('chatbots')
    .select('configuration_json')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .single();

  let initialGlobalBrandingHtml = '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>';
  let initialGlobalTrackingUrl = 'https://styleflo.ai';
  let initialGlobalVoiceDisclaimer = '';

  if (globalBot?.configuration_json) {
    if (globalBot.configuration_json.branding_html !== undefined) initialGlobalBrandingHtml = globalBot.configuration_json.branding_html;
    if (globalBot.configuration_json.branding_url !== undefined) initialGlobalTrackingUrl = globalBot.configuration_json.branding_url;
    if (globalBot.configuration_json.global_voice_disclaimer !== undefined) initialGlobalVoiceDisclaimer = globalBot.configuration_json.global_voice_disclaimer;
  }

  // Fetch all tenants
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, company_name, plan_tier, created_at, owner_id')
    .order('created_at', { ascending: false });

  // Fetch usage logs for current month
  const firstDay = new Date();
  firstDay.setDate(1);
  firstDay.setHours(0, 0, 0, 0);

  const { data: allUsage } = await supabase
    .from('usage_logs')
    .select('amount, feature_id, tenant_id')
    .gte('created_at', firstDay.toISOString());

  // Aggregate stats
  const tenantStats = (tenants || []).map(t => {
    const tenantUsage = (allUsage || []).filter(u => u.tenant_id === t.id);
    const messagesCount = tenantUsage.filter(u => u.feature_id === 'llm_tokens').reduce((sum, u) => sum + Number(u.amount), 0);
    const crawlsCount = tenantUsage.filter(u => u.feature_id === 'knowledge_base_crawls').reduce((sum, u) => sum + Number(u.amount), 0);

    return {
      id: t.id,
      company_name: t.company_name,
      plan_tier: t.plan_tier,
      created_at: t.created_at,
      messagesCount,
      crawlsCount
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
