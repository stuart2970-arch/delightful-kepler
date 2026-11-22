import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isFailedPaymentFlowEnabled } from '@/lib/billing/failed-payment/flag';
import { onFailedPaymentTransition } from '@/lib/billing/failed-payment/hook';
import { runFailedPaymentSweep } from '@/lib/billing/failed-payment/machine';
import { isFailedPaymentSweepAuthorized } from '@/lib/billing/failed-payment/sweep-auth';
import { resolveFailedPaymentStripeClient } from '@/lib/billing/failed-payment/stripe-client';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role key');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Daily failed-payment sweep. A scheduler (STYL-275) calls this.
 * This route does not create infrastructure and does not send email.
 * Authorization: `Authorization: Bearer ${FAILED_PAYMENT_SWEEP_SECRET}`.
 */
export async function POST(req: Request) {
  if (!isFailedPaymentSweepAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isFailedPaymentFlowEnabled()) {
    return NextResponse.json({
      success: true,
      disabled: true,
      examined: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
    }, { status: 200 });
  }

  try {
    const result = await runFailedPaymentSweep(getSupabaseAdmin(), {
      now: new Date(),
      stripe: resolveFailedPaymentStripeClient(),
      onTransition: onFailedPaymentTransition,
    });
    const status = result.failed > 0 ? 500 : 200;
    return NextResponse.json({ success: status === 200, ...result }, { status });
  } catch (err) {
    console.error('[failed-payment] sweep failed', {
      message: err instanceof Error ? err.message : 'sweep failed',
    });
    return NextResponse.json({ error: 'Failed payment sweep failed' }, { status: 500 });
  }
}
