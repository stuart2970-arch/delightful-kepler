import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export interface SuperAdminAuthSuccess {
  ok: true;
  user: any;
  userId: string;
}

export interface AuthFailure {
  ok: false;
  response: NextResponse;
}

export type SuperAdminAuthResult = SuperAdminAuthSuccess | AuthFailure;

/**
 * Validates whether the incoming request originates from an authenticated user (via cookie or Bearer JWT)
 */
export async function requireUser(req: NextRequest | Request): Promise<SuperAdminAuthResult> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
      };
    }

    const cookieStore = await cookies();
    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      }
    });

    // 1. Try to get user from cookie session
    let user: any = null;
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (!userError && userData?.user) {
      user = userData.user;
    }

    // 2. Fall back to Authorization: Bearer <jwt> if no cookie session
    if (!user) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token) {
          const { data: jwtData, error: jwtError } = await authClient.auth.getUser(token);
          if (!jwtError && jwtData?.user) {
            user = jwtData.user;
          }
        }
      }
    }

    if (!user) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      };
    }

    return {
      ok: true,
      user,
      userId: user.id
    };
  } catch (error: any) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    };
  }
}

/**
 * Checks if a specific userId possesses verified is_super_admin status using the service-role client (immune to RLS).
 */
export async function checkIsSuperAdmin(userId: string): Promise<boolean> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey || !userId) return false;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: profile, error } = await adminClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) return false;
    return profile.is_super_admin === true;
  } catch {
    return false;
  }
}

/**
 * Mandatory Server-Side Superadmin Gatekeeper.
 * Denies by default. Verifies user identity and checks profiles.is_super_admin using service-role.
 * No bypasses for development, env vars, or custom headers.
 */
export async function requireSuperAdmin(req: NextRequest | Request): Promise<SuperAdminAuthResult> {
  try {
    const userAuth = await requireUser(req);
    if (!userAuth.ok) {
      return userAuth;
    }

    const isSuper = await checkIsSuperAdmin(userAuth.userId);
    if (!isSuper) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
      };
    }

    return {
      ok: true,
      user: userAuth.user,
      userId: userAuth.userId
    };
  } catch (err: any) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    };
  }
}

/**
 * Higher-order wrapper for route handlers that enforces superadmin authentication.
 * Guarantees that requireSuperAdmin executes BEFORE any body or query parsing.
 */
export function withSuperAdmin<T = any>(
  handler: (req: NextRequest, ctx: T, admin: { user: any; userId: string }) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx?: T): Promise<NextResponse> => {
    const auth = await requireSuperAdmin(req);
    if (!auth.ok) {
      return auth.response;
    }
    return handler(req, (ctx ?? {}) as T, { user: auth.user, userId: auth.userId });
  };
}
