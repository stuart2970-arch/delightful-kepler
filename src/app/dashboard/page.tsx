import { createServerClient } from '@supabase/ssr';
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

export default async function DashboardPage() {
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
  
  let chatbots: any[] = [];
  let conversations: any[] = [];
  let metrics = {
    chatbotsCount: 0,
    chunksCount: 0,
    sessionsCount: 0,
    messagesCount: 0,
  };

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
        .select('company_name')
        .eq('id', tenantId)
        .single();
      
      if (tenant) {
        tenantName = tenant.company_name;
      }
    }

    // 3. Securely Fetch Dashboard Data using RLS
    // If user is super admin, we could bypass here or rely on RLS logic.
    // The DB Client is already running under the user's JWT. 
    // RLS in Postgres will handle filtering by tenant_id (or letting superadmin see all).
    
    // For now, we still explicitly query by tenantId unless they are super admin.
    let queryFilter = isSuperAdmin ? null : { key: 'tenant_id', value: tenantId };

    // Chatbots
    let botsQuery = supabase.from('chatbots').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) botsQuery = botsQuery.eq(queryFilter.key, queryFilter.value);
    const { data: bots } = await botsQuery;
    if (bots) chatbots = bots;

    // Conversations
    let convsQuery = supabase.from('conversations').select('*').order('created_at', { ascending: false });
    if (queryFilter && queryFilter.value) convsQuery = convsQuery.eq(queryFilter.key, queryFilter.value);
    const { data: convs } = await convsQuery;
    if (convs) conversations = convs;

    // Metrics (Chunks)
    let chunksQuery = supabase.from('document_chunks').select('*', { count: 'exact', head: true });
    if (queryFilter && queryFilter.value) chunksQuery = chunksQuery.eq(queryFilter.key, queryFilter.value);
    const { count: chunksCount } = await chunksQuery;

    // Metrics (Messages)
    let msgsQuery = supabase.from('messages').select('*', { count: 'exact', head: true });
    if (queryFilter && queryFilter.value) msgsQuery = msgsQuery.eq(queryFilter.key, queryFilter.value);
    const { count: msgsCount } = await msgsQuery;

    metrics = {
      chatbotsCount: chatbots.length,
      chunksCount: chunksCount || 0,
      sessionsCount: conversations.length,
      messagesCount: msgsCount || 0,
    };
  } catch (err) {
    console.error('[Dashboard] Error querying secure database:', err);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6 md:p-8 font-sans">
      <DashboardClient
        isDevMode={false}
        tenantId={tenantId}
        tenantName={tenantName}
        userEmail={userEmail}
        userName={userName}
        initialChatbots={chatbots}
        initialConversations={conversations}
        initialMetrics={metrics}
        isSuperAdmin={isSuperAdmin}
      />
    </main>
  );
}
