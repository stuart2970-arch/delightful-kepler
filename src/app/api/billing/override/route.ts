import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';

export const dynamic = 'force-dynamic';

export const POST = withSuperAdmin(async (request: NextRequest) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const { targetTenantId, newTier, isActive, subscriptionStatus } = body;

    if (!targetTenantId) {
      return NextResponse.json({ error: 'Missing targetTenantId' }, { status: 400 });
    }

    const updates: Record<string, any> = {};

    if (newTier !== undefined) {
      const validTiers = ['base_tier', 'foundation', 'basic', 'starter', 'premium', 'ultimate', 'trial', 'free'];
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
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
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
});
