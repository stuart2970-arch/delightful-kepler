import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Verify the request signature or secret to ensure it's actually from WPMUDEV
const WEBHOOK_SECRET = process.env.WPMUDEV_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    // 1. Authenticate the Webhook (if WEBHOOK_SECRET is set)
    const authHeader = req.headers.get('authorization');
    if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await req.json().catch(() => ({}));
    console.log('[WPMUDEV Webhook] Received payload:', rawBody);

    // Normalize incoming fields from WPMUDEV / Forminator
    const payload = rawBody.form_data || rawBody;
    
    const email = (payload.email || payload.user_email || payload['email-1'] || payload['text-1'] || '').toString().trim().toLowerCase();
    const tenantIdInput = payload.tenant_id || payload.tenantId;
    const companyName = payload.company_name || payload.business_name || payload['text-2'] || 'My Workspace';
    const fullName = payload.full_name || payload.name || payload['name-1'] || '';
    
    let planTier = (payload.plan_tier || payload.tier || payload.plan || 'base_tier').toString().toLowerCase();
    const validTiers = ['base_tier', 'basic', 'starter', 'premium', 'ultimate', 'trial'];
    if (!validTiers.includes(planTier)) {
      planTier = 'base_tier';
    }

    const isActive = payload.is_active !== undefined ? Boolean(payload.is_active) : true;

    // 2. Initialize Supabase Admin Client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[WPMUDEV Webhook] Missing Supabase admin credentials.');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    let targetTenantId = tenantIdInput;

    // 3. Resolve Tenant ID by Email if tenant_id is omitted
    if (!targetTenantId && email) {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = users.find(u => u.email?.toLowerCase() === email);

      if (existingUser) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('tenant_id')
          .eq('id', existingUser.id)
          .maybeSingle();

        if (profile?.tenant_id) {
          targetTenantId = profile.tenant_id;
        }
      } else {
        // Create new user in Supabase Auth
        const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            company_name: companyName,
            full_name: fullName
          }
        });

        if (createErr) {
          console.error('[WPMUDEV Webhook] Failed to auto-provision user:', createErr);
          return NextResponse.json({ error: createErr.message }, { status: 500 });
        }

        if (newUser.user) {
          // Fetch auto-created profile/tenant from handle_new_user trigger
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('tenant_id')
            .eq('id', newUser.user.id)
            .maybeSingle();

          if (profile?.tenant_id) {
            targetTenantId = profile.tenant_id;
          }
        }
      }
    }

    if (!targetTenantId) {
      return NextResponse.json({ error: 'Could not resolve or create tenant for request' }, { status: 400 });
    }

    // 4. Update tenant plan_tier and active status
    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({
        plan_tier: planTier,
        is_active: isActive,
        subscription_status: isActive ? 'active' : 'paused'
      })
      .eq('id', targetTenantId);

    if (updateError) {
      console.error('[WPMUDEV Webhook] Error updating tenant:', updateError);
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Tenant ${targetTenantId} updated to plan ${planTier} (Active: ${isActive})`,
      tenant_id: targetTenantId,
      plan_tier: planTier
    }, { status: 200 });

  } catch (error: any) {
    console.error('[WPMUDEV Webhook] Unhandled error:', error);
    return NextResponse.json({ error: error.message || 'Invalid request' }, { status: 400 });
  }
}
