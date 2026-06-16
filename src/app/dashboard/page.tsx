import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import DashboardClient from '@/components/DashboardClient';

// Helper to create server-side Supabase client
async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
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
  let isDevMode = false;
  let tenantId = 't0000000-0000-0000-0000-000000000001'; // Fallback to Acme Corp Seed
  let tenantName = 'Acme Corp (Development)';
  let userEmail = 'admin@acme.com';
  let userName = 'Acme Admin';
  let chatbots: any[] = [];
  let metrics = {
    chatbotsCount: 0,
    chunksCount: 0,
    sessionsCount: 0,
    messagesCount: 0,
  };
  let conversations: any[] = [];

  const supabase = await createSupabaseServerClient();

  // If Supabase is not configured or auth session is missing, run in Development Seed Mode
  if (!supabase) {
    isDevMode = true;
    console.warn('[Dashboard] Supabase env vars missing. Running in development seed mode.');
  } else {
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        isDevMode = true;
        console.warn('[Dashboard] No active session found. Running in development seed mode.');
      } else {
        userEmail = user.email || '';
        userName = user.user_metadata?.name || 'User';

        // Query user's profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('id', user.id)
          .single();

        if (profile) {
          tenantId = profile.tenant_id;
          
          // Fetch company name
          const { data: tenant } = await supabase
            .from('tenants')
            .select('company_name')
            .eq('id', tenantId)
            .single();
          
          if (tenant) {
            tenantName = tenant.company_name;
          }
        } else {
          isDevMode = true;
        }
      }
    } catch (err) {
      isDevMode = true;
      console.warn('[Dashboard] Failed to fetch session, falling back to seed mode:', err);
    }
  }

  // If we are in dev mode, we can fetch from Supabase using service key, or mock.
  // Wait! To make sure the developer sees their seed data even if not logged in,
  // we can fetch the seed data from the database using a service client or direct select if permitted.
  // If the user runs Supabase locally, they can query. Let's write the query to get data for tenantId.
  if (supabase) {
    try {
      // 1. Fetch Chatbots
      const { data: bots } = await supabase
        .from('chatbots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      
      if (bots) chatbots = bots;

      // 2. Fetch Metrics (Chunks count)
      const { count: chunksCount } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      // 3. Fetch conversations
      const { data: convs } = await supabase
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (convs) conversations = convs;

      // 4. Fetch metrics
      const { count: msgsCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      metrics = {
        chatbotsCount: chatbots.length,
        chunksCount: chunksCount || 0,
        sessionsCount: conversations.length,
        messagesCount: msgsCount || 0,
      };

    } catch (dbErr) {
      console.error('[Dashboard] Error querying database:', dbErr);
    }
  } else {
    // If no Supabase connection at all, populate full mock data for visual preview
    chatbots = [
      {
        id: 'ca111111-1111-4111-8111-111111111111',
        name: 'Acme Support Bot',
        primary_color: '#10B981',
        configuration_json: { welcome_message: 'Hello! I am the Acme support bot.' },
        created_at: new Date().toISOString(),
      },
      {
        id: 'ca222222-2222-4222-8222-222222222222',
        name: 'Globex Helpdesk',
        primary_color: '#4F46E5',
        configuration_json: { welcome_message: 'Welcome to Globex Support.' },
        created_at: new Date().toISOString(),
      }
    ];

    conversations = [
      {
        id: 'ea111111-1111-4111-8111-111111111111',
        chatbot_id: 'ca111111-1111-4111-8111-111111111111',
        user_session_id: 'session_test_acme',
        created_at: new Date().toISOString(),
      }
    ];

    metrics = {
      chatbotsCount: 2,
      chunksCount: 5,
      sessionsCount: 1,
      messagesCount: 2,
    };
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6 md:p-8 font-sans">
      <DashboardClient
        isDevMode={isDevMode}
        tenantId={tenantId}
        tenantName={tenantName}
        userEmail={userEmail}
        userName={userName}
        initialChatbots={chatbots}
        initialConversations={conversations}
        initialMetrics={metrics}
      />
    </main>
  );
}
