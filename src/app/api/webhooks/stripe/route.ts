import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseStripeWebhookEvent } from '@/lib/env/stripe-webhook';
import { handleStripeBillingEvent } from '@/lib/billing/process-stripe-webhook';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role key');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function POST(req: Request) {
  try {
    const payload = await req.text();
    const parsed = parseStripeWebhookEvent(payload, req.headers.get('stripe-signature'));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const event = parsed.event;
    console.log('[Stripe Webhook] Event received:', event.type || 'direct_payload');

    let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch {
      supabaseAdmin = null;
    }

    const result = await handleStripeBillingEvent(event, {
      supabaseAdmin,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    console.error('[Stripe Webhook] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
