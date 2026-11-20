import crypto from 'node:crypto';
import { secretsEqual } from '@/lib/security/secrets-equal';

export interface OAuthStateClaims {
  userId: string;
  tenantId: string;
  staffId: string | null;
  nonce: string;
  exp: number;
}

const TTL_MS = 15 * 60 * 1000;

function signingSecret(env: NodeJS.ProcessEnv): string | null {
  const dedicated = (env.OAUTH_STATE_SECRET || env.CHAT_SESSION_SIGNING_SECRET || '').trim();
  if (dedicated) return dedicated;
  const service = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!service) return null;
  return crypto.createHmac('sha256', service).update('styleflo-oauth-state-v1').digest('hex');
}

export function signOAuthState(
  input: { userId: string; tenantId: string; staffId?: string | null },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  const secret = signingSecret(env);
  if (!secret || !input.userId || !input.tenantId) return null;
  const claims: OAuthStateClaims = {
    userId: input.userId,
    tenantId: input.tenantId,
    staffId: input.staffId || null,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: now + TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `v1.${payload}.${sig}`;
}

/** Rejects unsigned base64 JSON and a bare tenant id. */
export function verifyOAuthState(
  state: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): OAuthStateClaims | null {
  if (!state || !state.startsWith('v1.')) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const secret = signingSecret(env);
  if (!secret) return null;
  const [, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!secretsEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthStateClaims;
    if (!claims?.userId || !claims.tenantId || !claims.nonce || typeof claims.exp !== 'number') return null;
    if (claims.exp < now) return null;
    return {
      userId: String(claims.userId),
      tenantId: String(claims.tenantId),
      staffId: claims.staffId ? String(claims.staffId) : null,
      nonce: String(claims.nonce),
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}
