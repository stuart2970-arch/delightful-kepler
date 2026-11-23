import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAccountClosureSweep } from '@/lib/account-closure/sweep';
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
 * Daily billing sweep. A scheduler calls this. This route does not create
 * that scheduler. One run pauses or cancels failed payments, sends the
 * closure reminder, deletes due accounts, releases held numbers, and sends
 * the deletion confirmation. A second run the same day does not repeat them.
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
    const admin = getSupabaseAdmin();
    const now = new Date();
    const result = await runFailedPaymentSweep(admin, {
      now,
      stripe: resolveFailedPaymentStripeClient(),
      onTransition: onFailedPaymentTransition,
    });
    const closure = await runAccountClosureSweep(admin, { now });
    const failed = result.failed + closure.failed;
    const status = failed > 0 ? 500 : 200;
    return NextResponse.json({ success: status === 200, ...result, closure }, { status });
  } catch (err) {
    console.error('[failed-payment] sweep failed', {
      message: err instanceof Error ? err.message : 'sweep failed',
    });
    return NextResponse.json({ error: 'Failed payment sweep failed' }, { status: 500 });
  }
}
