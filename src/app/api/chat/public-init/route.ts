import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signChatSessionToken } from '@/lib/chat-session';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-turnstile-token, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables missing for admin operations.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/**
 * POST /api/chat/public-init
 * Public widget initialization endpoint.
 * Verified by Cloudflare Turnstile at Edge/proxy level.
 * Validates chatbotId and returns a cryptographically signed session token.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { chatbotId, termsAccepted, termsVersion } = body;

    if (!chatbotId || typeof chatbotId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required chatbotId attribute.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Verify that chatbot exists and is active
    const { data: chatbot, error: botErr } = await supabaseAdmin
      .from('chatbots')
      .select('id, name')
      .eq('id', chatbotId)
      .maybeSingle();

    if (botErr || !chatbot) {
      return NextResponse.json(
        { success: false, error: `Chatbot not found or inactive: ${chatbotId}` },
        { status: 404, headers: corsHeaders }
      );
    }

    // 2. Generate server-side unique sessionId
    const sessionId = `session_${crypto.randomUUID()}`;
    const expiresInSeconds = 3600;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const isTermsAccepted = termsAccepted === true;
    const acceptedVersion = isTermsAccepted ? (termsVersion || '1.0') : null;
    const acceptedAt = isTermsAccepted ? new Date().toISOString() : null;

    // 3. Generate signed session token (HMAC-SHA256)
    const sessionToken = signChatSessionToken({
      chatbotId,
      sessionId,
      expiresInSeconds,
      termsAccepted: isTermsAccepted,
      termsVersion: acceptedVersion || undefined,
    });

    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';

    // 4. Persist session record in chat_sessions table
    const { error: insertErr } = await supabaseAdmin.from('chat_sessions').insert({
      chatbot_id: chatbotId,
      session_id: sessionId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip_address: clientIp,
      terms_accepted_at: acceptedAt,
      terms_version: acceptedVersion,
    });

    if (insertErr) {
      console.warn('[public-init] Failed to persist chat_session:', insertErr.message);
    }

    return NextResponse.json(
      {
        success: true,
        sessionToken,
        sessionId,
        expiresInSeconds,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('[Public Init Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal session initialization error.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
