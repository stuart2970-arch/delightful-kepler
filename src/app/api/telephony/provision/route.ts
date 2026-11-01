import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import twilio from 'twilio';
import { handleProvisionPost, type ProvisionDeps } from '@/lib/telephony/provision-flow';

export { handleProvisionPost };

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

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceKey);
}

export async function createDefaultProvisionDeps(): Promise<ProvisionDeps> {
  const supabase = await getSupabaseAuthClient();
  return {
    getUser: async (request) => {
      let user = (await supabase.auth.getUser()).data?.user || null;
      if (!user) {
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.replace('Bearer ', '').trim();
          const { data: userData } = await supabase.auth.getUser(token);
          if (userData?.user) user = userData.user;
        }
      }
      return user ? { id: user.id } : null;
    },
    userSupabase: supabase as unknown as ProvisionDeps['userSupabase'],
    adminSupabase: getSupabaseAdmin() as unknown as ProvisionDeps['adminSupabase'],
    createTwilio: (accountSid, authToken) => twilio(accountSid, authToken) as unknown as ReturnType<ProvisionDeps['createTwilio']>,
  };
}

export async function POST(request: Request) {
  try {
    return handleProvisionPost(request, await createDefaultProvisionDeps());
  } catch (error: any) {
    console.error('[Telephony Provisioning API] Unexpected error', { message: error?.message });
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
