import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-superadmin';
import { verifyOAuthState } from '@/lib/auth/oauth-state';
import { isMockOAuthCodeAllowed } from '@/lib/env/allow-mock-oauth';
import { createAdminClient } from '@/utils/supabase-admin';

export interface OAuthCallbackSuccess {
  ok: true;
  userId: string;
  tenantId: string;
  staffId: string | null;
  code: string;
}

export type OAuthCallbackResult =
  | OAuthCallbackSuccess
  | { ok: false; response: NextResponse };

/**
 * Calendar OAuth return. The caller must be the signed-in user named in a
 * signed state, and that state must name their tenant. Unsigned and legacy
 * plain-tenantId states are rejected. mock_ codes are rejected unless the
 * test-only flag is on and the app is not production.
 */
export async function requireOAuthCallback(
  request: Request,
  code: string | null,
  state: string | null,
): Promise<OAuthCallbackResult> {
  const auth = await requireUser(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  if (!code || !state) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing code or state params' }, { status: 400 }),
    };
  }

  const claims = verifyOAuthState(state);
  if (!claims) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 }),
    };
  }

  if (claims.userId !== auth.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', auth.userId)
    .maybeSingle();

  if (!profile?.tenant_id || String(profile.tenant_id) !== claims.tenantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  if (code.startsWith('mock_') && !isMockOAuthCodeAllowed()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Mock OAuth codes are disabled' }, { status: 400 }),
    };
  }

  const connectAllowed = await calendarConnectAllowed(auth.userId, claims.tenantId, claims.staffId);
  if (!connectAllowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    userId: auth.userId,
    tenantId: claims.tenantId,
    staffId: claims.staffId,
    code,
  };
}

/** Salon-wide calendar connect is owner or admin. A staff connect is also
 * allowed for the staff row whose user_id is the signed-in user. */
export async function calendarConnectAllowed(
  userId: string,
  tenantId: string,
  staffId: string | null,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tenant_id, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.tenant_id || String(profile.tenant_id) !== tenantId) return false;
  if (profile.is_super_admin === true) return true;
  const privileged = profile.role === 'owner' || profile.role === 'admin';
  if (!staffId) return privileged;
  if (privileged) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id, tenant_id')
      .eq('id', staffId)
      .maybeSingle();
    return !!staff && String(staff.tenant_id) === tenantId;
  }
  const { data: staff } = await supabase
    .from('staff')
    .select('id, tenant_id, user_id, email')
    .eq('id', staffId)
    .maybeSingle();
  if (!staff || String(staff.tenant_id) !== tenantId) return false;
  if (staff.user_id === userId) return true;
  if (staff.user_id) return false;
  const { data: account } = await supabase.auth.admin.getUserById(userId);
  const email = account?.user?.email?.trim().toLowerCase();
  return !!email && String(staff.email || '').trim().toLowerCase() === email;
}
