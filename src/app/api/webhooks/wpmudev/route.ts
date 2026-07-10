import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Verify the request signature or secret to ensure it's actually from WPMUDEV
const WEBHOOK_SECRET = process.env.WPMUDEV_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    // 1. Authenticate the Webhook (Optional but highly recommended)
    const authHeader = req.headers.get('authorization');
    if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    console.log('[Webhook] Received WPMUDEV payment update:', body);

    const { tenant_id, plan_tier, is_active } = body;

    if (!tenant_id || !plan_tier) {
      return NextResponse.json({ error: 'Missing tenant_id or plan_tier in payload' }, { status: 400 });
    }

    // 2. Initialize Supabase Admin Client to bypass RLS
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[Webhook] Missing Supabase admin credentials.');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 3. Update the tenant's plan tier
    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({ plan_tier })
      .eq('id', tenant_id);

    if (updateError) {
      console.error('[Webhook] Error updating tenant:', updateError);
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
    }

    // Optional: Log this event in an audit table or reset usage if needed
    
    return NextResponse.json({ success: true, message: `Tenant ${tenant_id} upgraded to ${plan_tier}` }, { status: 200 });
  } catch (error) {
    console.error('[Webhook] Unhandled error:', error);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
