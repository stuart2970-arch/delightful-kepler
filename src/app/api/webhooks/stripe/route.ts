import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { parseStripeWebhookEvent } from '@/lib/env/stripe-webhook';
import { handleStripeBillingEvent } from '@/lib/billing/process-stripe-webhook';
import { notifyBoltOnsAddedFromStripeEvent } from '@/lib/email/system/triggers/batch2/bolt-on-added';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role key');
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

function stripeWebhookDeps() {
  const apiKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!apiKey) return undefined;
  const stripe = new Stripe(apiKey, { apiVersion: '2023-10-16' as Stripe.LatestApiVersion });
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        const sub = await stripe.subscriptions.retrieve(id);
        return { status: sub.status, trial_end: sub.trial_end };
      },
    },
  };
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
      stripe: stripeWebhookDeps(),
    });
    if (result.status >= 200 && result.status < 300) {
      try {
        await notifyBoltOnsAddedFromStripeEvent(event);
      } catch {
        console.error('[system-email] bolt-on added email was not sent');
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    console.error('[Stripe Webhook] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
