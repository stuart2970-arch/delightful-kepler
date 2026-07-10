import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Vapi sends a POST request with call details.
// We only care about 'end-of-call-report' messages.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Vapi webhook payload structure
    const message = body.message;
    if (!message || message.type !== 'end-of-call-report') {
      return NextResponse.json({ success: true, ignored: true });
    }

    const { call } = message;
    if (!call) {
      return NextResponse.json({ error: 'Missing call object' }, { status: 400 });
    }

    // Extract tenant_id from metadata we pass when starting the call
    const tenantId = call.metadata?.tenant_id || call.assistantOverrides?.variableValues?.tenant_id;
    if (!tenantId) {
      console.warn('[Vapi Webhook] No tenant_id found in call metadata, skipping metering.');
      return NextResponse.json({ success: true, ignored: true });
    }

    // Calculate duration in minutes (ceiling)
    const durationSeconds = call.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);

    if (durationMinutes <= 0) {
      return NextResponse.json({ success: true, ignored: true });
    }

    // Initialize Supabase Admin Client to bypass RLS
    const supabaseUrl = process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin environment variables are missing');
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Fetch current feature to get unit_cost_estimated
    const { data: feature } = await supabaseAdmin
      .from('features')
      .select('unit_cost_estimated')
      .eq('id', 'vapi_voice_minutes')
      .single();

    const unitCost = feature?.unit_cost_estimated || 0;
    const actualCost = unitCost * durationMinutes;

    // 2. Insert Usage Log into usage_ledger
    const { error: insertError } = await supabaseAdmin.from('usage_ledger').insert({
      tenant_id: tenantId,
      feature_id: 'vapi_voice_minutes',
      quantity: durationMinutes,
      actual_cost: actualCost,
      sector_tag: `Vapi Call ID: ${call.id}`,
    });

    if (insertError) {
      console.error('[Vapi Webhook] Failed to insert usage ledger:', insertError);
      return NextResponse.json({ error: 'Failed to record usage' }, { status: 500 });
    }

    console.log(`[Vapi Webhook] Successfully metered ${durationMinutes} minutes for tenant ${tenantId}`);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[Vapi Webhook] Error processing webhook:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
