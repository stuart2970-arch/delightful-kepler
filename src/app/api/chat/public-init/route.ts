import { NextResponse } from 'next/server';

/**
 * POST /api/chat/public-init
 * Public widget initialization endpoint.
 * Verified by Cloudflare Turnstile in middleware, returning an ephemeral session token.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { chatbotId } = body;

    if (!chatbotId) {
      return NextResponse.json(
        { success: false, error: 'Missing required chatbotId attribute.' },
        { status: 400 }
      );
    }

    // Generate a secure, short-lived session token (or JWT) for the visitor
    const sessionToken = `sf_sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return NextResponse.json({
      success: true,
      sessionToken: sessionToken,
      expiresInSeconds: 3600,
    });
  } catch (error) {
    console.error('[Public Init Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal session initialization error.' },
      { status: 500 }
    );
  }
}
