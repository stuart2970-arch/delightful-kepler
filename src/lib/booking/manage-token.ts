import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url';

export const MANAGE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hashManageToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Absolute https URL for emails and chat (never a relative path). */
export function manageBookingUrl(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  const origin = resolveServerPublicAppOrigin(env).replace(/\/+$/, '');
  return `${origin}/booking/manage?token=${encodeURIComponent(rawToken)}`;
}

export type IssuedManageToken = {
  rawToken: string;
  manageUrl: string;
  expiresAt: string;
};

/**
 * Returns true when a non-expired manage token row already exists (link was likely emailed).
 */
export async function hasActiveManageToken(appointmentId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data } = await admin
    .from('appointment_manage_tokens')
    .select('appointment_id')
    .eq('appointment_id', appointmentId)
    .gt('expires_at', now)
    .maybeSingle();
  return Boolean(data?.appointment_id);
}

/**
 * Issues or rotates a manage token for an appointment. Returns the raw token once;
 * only the hash is persisted.
 */
export async function issueManageToken(
  appointmentId: string,
  options?: { replaceExisting?: boolean },
): Promise<IssuedManageToken> {
  const replaceExisting = options?.replaceExisting !== false;
  const admin = getSupabaseAdmin();

  if (!replaceExisting) {
    const active = await hasActiveManageToken(appointmentId);
    if (active) {
      throw new Error('ACTIVE_MANAGE_TOKEN_EXISTS');
    }
  }

  const rawToken = generateRawToken();
  const tokenHash = hashManageToken(rawToken);
  const expiresAt = new Date(Date.now() + MANAGE_TOKEN_TTL_MS).toISOString();

  const { error } = await admin.from('appointment_manage_tokens').upsert(
    {
      appointment_id: appointmentId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
    { onConflict: 'appointment_id' },
  );

  if (error) {
    throw new Error(`Failed to persist manage token: ${error.message}`);
  }

  return {
    rawToken,
    manageUrl: manageBookingUrl(rawToken),
    expiresAt,
  };
}

export type ResolvedManageToken = {
  appointmentId: string;
  expiresAt: string;
};

export async function resolveManageToken(rawToken: string): Promise<ResolvedManageToken | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const admin = getSupabaseAdmin();
  const tokenHash = hashManageToken(rawToken);
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('appointment_manage_tokens')
    .select('appointment_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', now)
    .maybeSingle();

  if (error || !data?.appointment_id) return null;

  return {
    appointmentId: data.appointment_id as string,
    expiresAt: data.expires_at as string,
  };
}