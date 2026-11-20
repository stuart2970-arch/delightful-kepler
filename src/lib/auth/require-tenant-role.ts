import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser, type AuthFailure } from '@/lib/auth/require-superadmin';
import { recordSuperadminAudit } from '@/lib/auth/superadmin-audit';

export type TenantRole = 'owner' | 'admin' | 'member';

export interface TenantRoleSuccess {
  ok: true;
  userId: string;
  tenantId: string;
  email: string | null;
  role: TenantRole;
  isSuperAdmin: boolean;
}

export type TenantRoleResult = TenantRoleSuccess | AuthFailure;

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Body tenant ids are never a source of membership. Superadmin may name a
 * target tenant; anyone else sending a mismatched id is rejected.
 */
export async function peekClaimedTenantId(req: Request): Promise<string | undefined> {
  try {
    const body = await req.clone().json();
    if (!body || typeof body !== 'object') return undefined;
    const raw = (body as { tenantId?: unknown; tenant_id?: unknown }).tenantId
      ?? (body as { tenant_id?: unknown }).tenant_id;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  } catch {
    // Missing or non-JSON body.
  }
  return undefined;
}

/**
 * Session membership gate. Tenant comes from profiles(id, tenant_id, role).
 * A body tenantId is only honoured for profiles.is_super_admin (audited).
 */
export async function requireTenantRole(
  req: NextRequest | Request,
  allowedRoles: TenantRole[],
): Promise<TenantRoleResult> {
  const userAuth = await requireUser(req);
  if (!userAuth.ok) return userAuth;

  const supabase = adminClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server configuration error' }, { status: 500 }),
    };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('tenant_id, role, is_super_admin')
    .eq('id', userAuth.userId)
    .maybeSingle();

  if (error || !profile?.tenant_id) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const sessionTenantId = String(profile.tenant_id);
  const role = profile.role as TenantRole;
  const isSuperAdmin = profile.is_super_admin === true;
  const claimedTenantId = await peekClaimedTenantId(req);
  const email = typeof userAuth.user?.email === 'string' && userAuth.user.email.trim()
    ? userAuth.user.email.trim()
    : null;

  if (isSuperAdmin) {
    const tenantId = claimedTenantId || sessionTenantId;
    recordSuperadminAudit({
      action: 'require_tenant_role',
      userId: userAuth.userId,
      tenantId,
      claimedTenantId: claimedTenantId ?? null,
      detail: { allowedRoles },
    });
    return {
      ok: true,
      userId: userAuth.userId,
      tenantId,
      email,
      role: allowedRoles.includes(role) ? role : 'owner',
      isSuperAdmin: true,
    };
  }

  if (claimedTenantId && claimedTenantId !== sessionTenantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  if (!allowedRoles.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    userId: userAuth.userId,
    tenantId: sessionTenantId,
    email,
    role,
    isSuperAdmin: false,
  };
}

/** Any signed-in salon member: owner, admin, or member. Tenant comes from the session. */
export function requireTenantMember(req: NextRequest | Request): Promise<TenantRoleResult> {
  return requireTenantRole(req, ['owner', 'admin', 'member']);
}
