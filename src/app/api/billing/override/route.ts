import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // We use the regular client to verify the currently authenticated user
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const authClient = createServerClient(supabaseUrl, anonKey!, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {}
      }
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is superadmin
    const { data: profile } = await authClient
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_super_admin) {
      return NextResponse.json({ error: 'Forbidden. Superadmin privileges required.' }, { status: 403 });
    }

    const body = await request.json();
    const { targetTenantId, newTier, isActive, subscriptionStatus } = body;

    if (!targetTenantId) {
      return NextResponse.json({ error: 'Missing targetTenantId' }, { status: 400 });
    }

    const updates: Record<string, any> = {};

    if (newTier !== undefined) {
      const validTiers = ['basic', 'starter', 'premium', 'ultimate', 'trial', 'free'];
      if (!validTiers.includes(newTier)) {
        return NextResponse.json({ error: 'Invalid subscription tier' }, { status: 400 });
      }
      updates.plan_tier = newTier;
    }

    if (typeof isActive === 'boolean') {
      updates.is_active = isActive;
    }

    if (subscriptionStatus !== undefined) {
      updates.subscription_status = subscriptionStatus;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No update parameters provided' }, { status: 400 });
    }

    // Use Service Role to bypass RLS and force the update on the target tenant
    const adminClient = createServerClient(supabaseUrl, supabaseServiceKey, {
      cookies: {
        getAll() { return []; },
        setAll() {}
      }
    });

    const { error: updateError } = await adminClient
      .from('tenants')
      .update(updates)
      .eq('id', targetTenantId);

    if (updateError) {
      console.error('[Billing Override] Error updating tenant:', updateError);
      return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Tenant ${targetTenantId} updated successfully`, 
      updates 
    });

  } catch (err: any) {
    console.error('[Billing Override] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
