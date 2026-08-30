import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/dashboard';

  if (code) {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
              // Safe to ignore in Server Components / Route Handlers
            }
          },
        },
      });

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        console.log(`[Auth Callback] Successfully exchanged code for session cookie. Redirecting to ${next}...`);
        return NextResponse.redirect(`${origin}${next}`);
      } else {
        console.error('[Auth Callback] Code exchange error:', error.message);
      }
    }
  }

  // Fallback if no code or exchange failed
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
