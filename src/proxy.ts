import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Middleware Error: Supabase environment variables are missing at runtime.");
    return NextResponse.next({ request });
  }

  // Determine the shared domain for SSO based on environment
  const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
  const sharedDomain = isLocal ? '.styleflo.test' : '.styleflo.ai';

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            options = options || {};
            options.domain = sharedDomain;
            options.sameSite = 'lax';
            request.cookies.set(name, value);
          });
          
          supabaseResponse = NextResponse.next({
            request,
          });
          
          cookiesToSet.forEach(({ name, value, options }) => {
            options = options || {};
            options.domain = sharedDomain;
            options.sameSite = 'lax';
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Sync SSO token for WordPress
  if (session?.access_token) {
    supabaseResponse.cookies.set('styleflo_sso_token', session.access_token, {
      domain: sharedDomain,
      path: '/',
      sameSite: 'lax',
      secure: !isLocal,
      maxAge: 60 * 60 * 24 * 7 // 1 week
    });
  } else {
    supabaseResponse.cookies.delete({
      name: 'styleflo_sso_token',
      domain: sharedDomain,
      path: '/'
    });
  }

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard');

  // Helper to transfer cookies to a redirect response
  const redirectWithCookies = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(cookie => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  };

  if (request.nextUrl.pathname === '/') {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    return redirectWithCookies(dashboardUrl);
  }

  if (isProtectedRoute && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return redirectWithCookies(loginUrl);
  }

  if (request.nextUrl.pathname === '/login' && user) {
    // We want to bounce them back to the WordPress wrapper now that they have the SSO cookie
    const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';
    return redirectWithCookies(new URL(wpAppUrl));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/chatbots|api/track|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
