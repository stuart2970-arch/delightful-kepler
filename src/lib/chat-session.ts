import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export interface ChatSessionPayload {
  chatbotId: string;
  sessionId: string;
  exp: number;
  iat: number;
  termsAccepted?: boolean;
  termsVersion?: string;
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

function getSigningSecret(): string {
  if (process.env.CHAT_SESSION_SIGNING_SECRET) {
    return process.env.CHAT_SESSION_SIGNING_SECRET;
  }
  const fallbackSource = process.env.SUPABASE_SERVICE_ROLE_KEY || 'styleflo-internal-chat-signing-salt';
  return crypto.createHmac('sha256', fallbackSource).update('styleflo-chat-session-signing-v1').digest('hex');
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Signs a chat session token using HMAC-SHA256
 */
export function signChatSessionToken(params: {
  chatbotId: string;
  sessionId: string;
  expiresInSeconds?: number;
  termsAccepted?: boolean;
  termsVersion?: string;
}): string {
  const { chatbotId, sessionId, expiresInSeconds = 3600, termsAccepted, termsVersion } = params;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: ChatSessionPayload = {
    chatbotId,
    sessionId,
    iat: now,
    exp: now + expiresInSeconds,
    ...(termsAccepted !== undefined ? { termsAccepted } : {}),
    ...(termsVersion ? { termsVersion } : {}),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const secret = getSigningSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signatureInput}.${signature}`;
}

/**
 * Cryptographically verifies a chat session token
 */
export function verifyChatSessionToken(token: string): {
  valid: boolean;
  payload?: ChatSessionPayload;
  error?: string;
} {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or invalid type.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure.' };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const secret = getSigningSecret();
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  try {
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token signature.' };
    }

    const payloadJson = base64UrlDecode(encodedPayload);
    const payload: ChatSessionPayload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Session token has expired.' };
    }

    if (!payload.chatbotId || !payload.sessionId) {
      return { valid: false, error: 'Token missing required claims.' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Token verification failure.' };
  }
}

/**
 * Multi-tier rate limiting using PostgreSQL counter table
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetSeconds: number }> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const now = new Date();
    const windowStartThreshold = new Date(now.getTime() - windowSeconds * 1000).toISOString();

    const { data: existing, error: selectErr } = await supabaseAdmin
      .from('chat_rate_limits')
      .select('rate_key, count, window_start')
      .eq('rate_key', key)
      .maybeSingle();

    if (selectErr && selectErr.code !== 'PGRST116') {
      console.warn('[RateLimit] Select error:', selectErr.message);
      return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
    }

    if (!existing || new Date(existing.window_start).toISOString() < windowStartThreshold) {
      // New window or expired window: upsert count = 1
      await supabaseAdmin.from('chat_rate_limits').upsert({
        rate_key: key,
        count: 1,
        window_start: now.toISOString(),
        updated_at: now.toISOString(),
      });
      return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
    }

    if (existing.count >= limit) {
      const windowStart = new Date(existing.window_start).getTime();
      const resetSeconds = Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - now.getTime()) / 1000));
      return { allowed: false, remaining: 0, resetSeconds };
    }

    // Increment count
    const nextCount = existing.count + 1;
    await supabaseAdmin
      .from('chat_rate_limits')
      .update({ count: nextCount, updated_at: now.toISOString() })
      .eq('rate_key', key);

    return {
      allowed: true,
      remaining: Math.max(0, limit - nextCount),
      resetSeconds: Math.ceil((new Date(existing.window_start).getTime() + windowSeconds * 1000 - now.getTime()) / 1000),
    };
  } catch (err) {
    console.warn('[RateLimit] Execution failed, allowing request gracefully:', err);
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }
}
