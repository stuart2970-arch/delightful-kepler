import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    console.log('[Stripe Webhook] Event received:', rawBody.type || 'direct_payload');

    const event = rawBody;
    const dataObject = event.data?.object || rawBody;

    // Extract email from Stripe checkout session or customer details
    const email = (
      dataObject.customer_details?.email || 
      dataObject.customer_email || 
      dataObject.email || 
      dataObject.metadata?.email || 
      ''
    ).toString().trim().toLowerCase();

    // Extract plan tier from metadata or fallback to 'pro'
    let planTier = (dataObject.metadata?.plan_tier || dataObject.metadata?.tier || 'pro').toString().toLowerCase();
    const validTiers = ['basic', 'starter', 'premium', 'ultimate', 'trial'];
    if (!validTiers.includes(planTier)) {
      planTier = 'pro';
    }

    const tenantIdInput = dataObject.metadata?.tenant_id || dataObject.client_reference_id;

    if (!email && !tenantIdInput) {
      console.warn('[Stripe Webhook] Missing customer email or tenant_id in payload');
      return NextResponse.json({ message: 'Ignored payload without email or tenant_id' }, { status: 200 });
    }

    // Initialize Supabase Admin Client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[Stripe Webhook] Missing Supabase service role key');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    let targetTenantId = tenantIdInput;

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
        // Auto-provision user on payment if missing
        const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
        const companyName = dataObject.metadata?.company_name || 'My Business';
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            company_name: companyName,
          }
        });

        if (createErr) {
          console.error('[Stripe Webhook] Auto-provisioning user failed:', createErr);
          return NextResponse.json({ error: createErr.message }, { status: 500 });
        }

        if (newUser.user) {
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
      return NextResponse.json({ error: 'Target tenant could not be resolved' }, { status: 400 });
    }

    // Update tenant plan_tier and active status
    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({
        plan_tier: planTier,
        is_active: true,
        subscription_status: 'active'
      })
      .eq('id', targetTenantId);

    if (updateError) {
      console.error('[Stripe Webhook] Error updating tenant:', updateError);
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
    }

    console.log(`[Stripe Webhook] Successfully activated tenant ${targetTenantId} on plan ${planTier}`);

    return NextResponse.json({
      success: true,
      message: `Tenant ${targetTenantId} activated on ${planTier} via Stripe`,
      tenant_id: targetTenantId,
      plan_tier: planTier
    }, { status: 200 });

  } catch (err: any) {
    console.error('[Stripe Webhook] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
