import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Unauthenticated public routes requiring Cloudflare Turnstile bot verification
const PUBLIC_TURNSTILE_ROUTES = ['/api/auth/signup', '/api/chat/public-init'];

// Authenticated chat stream routes requiring session JWT authorization
const CHAT_STREAM_ROUTES = ['/api/chat/stream'];

export async function proxy(request: NextRequest) {
  // 0. Always allow CORS OPTIONS preflight requests to pass through cleanly
  if (request.method === 'OPTIONS') {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;

  // 1. FRONT-DOOR BOT PROTECTION: Turnstile verification for unauthenticated signup & widget init
  if (PUBLIC_TURNSTILE_ROUTES.some((route) => pathname.startsWith(route))) {
    const turnstileToken = request.headers.get('x-turnstile-token');
    const clientIp = request.headers.get('x-forwarded-for') || request.ip || '127.0.0.1';
    const isDevSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA';

    if (!turnstileToken) {
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: 'Bot protection token is missing. Access denied.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const formData = new URLSearchParams();
      formData.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA');
      formData.append('response', turnstileToken);
      formData.append('remoteip', clientIp);

      const verificationResponse = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        }
      );

      const verificationResult = (await verificationResponse.json()) as { success: boolean; 'error-codes'?: string[] };

      if (!verificationResult.success) {
        console.warn(`[Bot Warning] Turnstile verification failed for IP: ${clientIp}. Errors:`, verificationResult['error-codes']);
        
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: 'Bot challenge verification failed. Access denied.',
            details: isDevSecret ? 'Development sandbox bypass active' : undefined,
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      console.log(`[Security] Turnstile verification passed for IP: ${clientIp}`);
    } catch (error) {
      console.error('[Security Error] Failed to contact Cloudflare Turnstile verify API:', error);
      
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: 'Security gate temporary malfunction. Please try again.',
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // 2. CHAT STREAM PROTECTION: Validate Authorization JWT header or session token
  if (CHAT_STREAM_ROUTES.some((route) => pathname.startsWith(route))) {
    const authHeader = request.headers.get('authorization');
    const sessionToken = request.headers.get('x-session-token');

    if (!authHeader && !sessionToken) {
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: 'Unauthorized. Valid session token or JWT required to access chat stream.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

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
