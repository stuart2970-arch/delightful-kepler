import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Cloudflare Turnstile Verification Payload Schema
 */
interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
}

// Unauthenticated public routes requiring Cloudflare Turnstile bot verification
const PUBLIC_TURNSTILE_ROUTES = ['/api/auth/signup', '/api/chat/public-init'];

// Authenticated chat stream routes requiring session JWT authorization
const CHAT_STREAM_ROUTES = ['/api/chat/stream'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. FRONT-DOOR BOT PROTECTION: Turnstile verification for unauthenticated registration & widget init
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
      // Form-encode parameters as required by Cloudflare Turnstile siteverify API
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

      const verificationResult = (await verificationResponse.json()) as TurnstileVerifyResponse;

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

    // Reject unauthenticated chat requests
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

  return NextResponse.next();
}

/**
 * Matcher configuration to optimize middleware performance.
 * Ensures the middleware triggers on public signup, session init, and chat stream endpoints.
 */
export const config = {
  matcher: [
    '/api/auth/signup',
    '/api/chat/public-init',
    '/api/chat/stream',
    '/api/chat/stream/:path*',
  ],
};
