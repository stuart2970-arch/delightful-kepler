import {
  dueFailedPaymentTransitions,
  type DueFailedPaymentTransition,
  type FailedPaymentSnapshot,
  type FailedPaymentStatus,
} from '@/lib/billing/failed-payment/evaluate';
import {
  onFailedPaymentTransition,
  type FailedPaymentTransitionEvent,
  type FailedPaymentTransitionHandler,
  type FailedPaymentTransitionKind,
} from '@/lib/billing/failed-payment/hook';
import {
  resolveFailedPaymentStripeClient,
  type FailedPaymentStripeClient,
} from '@/lib/billing/failed-payment/stripe-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export type FailedPaymentCaseRow = {
  id: string;
  tenant_id: string;
  stripe_invoice_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  first_failed_at: string;
  paused_at: string | null;
  restarted_at: string | null;
  cancelled_at: string | null;
  written_off_invoice_id: string | null;
  status: FailedPaymentStatus;
};

export type FailedPaymentSettlement =
  | { action: 'ignore' }
  | { action: 'blocked_cancelled' }
  | { action: 'restart'; row: FailedPaymentCaseRow }
  | { action: 'recover'; row: FailedPaymentCaseRow };

export type FailedPaymentSweepResult = {
  examined: number;
  applied: number;
  skipped: number;
  failed: number;
};

type ClaimAction = 'process' | 'skip' | 'locked';

type DbError = { message?: string; code?: string } | null;

type FailedPaymentDb = SupabaseClient;

function dbError(error: DbError, fallback: string): Error {
  return new Error(error?.message || fallback);
}

export function failedPaymentTransitionKey(kind: FailedPaymentTransitionKind, stripeInvoiceId: string): string {
  return `${kind}:${stripeInvoiceId.trim()}`;
}

export function snapshotFromFailedPaymentCase(row: FailedPaymentCaseRow): FailedPaymentSnapshot {
  return {
    status: row.status,
    firstFailedAt: row.first_failed_at,
    pausedAt: row.paused_at,
    restartedAt: row.restarted_at,
    cancelledAt: row.cancelled_at,
    writtenOffInvoiceId: row.written_off_invoice_id,
  };
}

const CASE_COLUMNS = 'id, tenant_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, first_failed_at, paused_at, restarted_at, cancelled_at, written_off_invoice_id, status';

async function loadCaseByInvoice(db: FailedPaymentDb, stripeInvoiceId: string): Promise<FailedPaymentCaseRow | null> {
  const invoiceId = stripeInvoiceId.trim();
  if (!invoiceId) return null;
  const { data, error } = await db
    .from('failed_payment_cases')
    .select(CASE_COLUMNS)
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle();
  if (error) throw dbError(error, 'Could not read the failed payment case');
  return (data as FailedPaymentCaseRow | null) ?? null;
}

function isUniqueViolation(error: DbError): boolean {
  return String(error?.code || '') === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

export async function recordInitialFailedPayment(
  db: FailedPaymentDb,
  input: {
    tenantId: string;
    stripeInvoiceId: string;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
    firstFailedAt: string;
  },
): Promise<string | null> {
  const invoiceId = input.stripeInvoiceId.trim();
  const tenantId = input.tenantId.trim();
  if (!invoiceId || !tenantId) return null;

  const existing = await loadCaseByInvoice(db, invoiceId);
  if (existing) {
    const subscriptionId = (input.stripeSubscriptionId || '').trim();
    if ((existing.status === 'past_due' || existing.status === 'paused') && !existing.stripe_subscription_id && subscriptionId) {
      const { error } = await db
        .from('failed_payment_cases')
        .update({ stripe_subscription_id: subscriptionId, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw dbError(error, 'Could not record the failed payment');
    }
    return existing.id;
  }

  const { data, error } = await db
    .from('failed_payment_cases')
    .insert({
      tenant_id: tenantId,
      stripe_invoice_id: invoiceId,
      stripe_subscription_id: (input.stripeSubscriptionId || '').trim() || null,
      stripe_customer_id: (input.stripeCustomerId || '').trim() || null,
      first_failed_at: input.firstFailedAt,
      status: 'past_due',
    })
    .select('id')
    .maybeSingle();
  if (error && isUniqueViolation(error)) {
    const raced = await loadCaseByInvoice(db, invoiceId);
    return raced?.id ?? null;
  }
  if (error) throw dbError(error, 'Could not record the failed payment');
  return (data as { id?: string } | null)?.id ?? null;
}

export async function readFailedPaymentSettlement(
  db: FailedPaymentDb,
  stripeInvoiceId: string,
): Promise<FailedPaymentSettlement> {
  const row = await loadCaseByInvoice(db, stripeInvoiceId);
  if (!row) return { action: 'ignore' };
  if (row.cancelled_at || row.status === 'cancelled' || row.written_off_invoice_id) {
    return { action: 'blocked_cancelled' };
  }
  if (row.restarted_at || row.status === 'restarted' || row.status === 'recovered') {
    return { action: 'ignore' };
  }
  if (row.paused_at || row.status === 'paused') return { action: 'restart', row };
  if (row.status === 'past_due') return { action: 'recover', row };
  return { action: 'ignore' };
}

async function claimTransition(
  db: FailedPaymentDb,
  row: FailedPaymentCaseRow,
  kind: FailedPaymentTransitionKind,
  occurredAt: string,
): Promise<ClaimAction> {
  const { data, error } = await db.rpc('claim_failed_payment_transition', {
    p_case_id: row.id,
    p_tenant_id: row.tenant_id,
    p_transition: kind,
    p_idempotency_key: failedPaymentTransitionKey(kind, row.stripe_invoice_id),
    p_occurred_at: occurredAt,
  });
  if (error) throw dbError(error, 'Could not claim the failed payment transition');
  const action = String(data || '');
  if (action === 'skip' || action === 'locked') return action;
  return 'process';
}

async function completeTransition(
  db: FailedPaymentDb,
  key: string,
  success: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.rpc('complete_failed_payment_transition', {
    p_idempotency_key: key,
    p_success: success,
    p_detail: detail,
  });
  if (error) throw dbError(error, 'Could not complete the failed payment transition');
}

function requireSubscriptionId(row: FailedPaymentCaseRow): string {
  const subscriptionId = (row.stripe_subscription_id || '').trim();
  if (!subscriptionId) {
    throw new Error('Failed payment case has no Stripe subscription');
  }
  return subscriptionId;
}

async function pauseTenant(db: FailedPaymentDb, tenantId: string): Promise<void> {
  const { error } = await db
    .from('tenants')
    .update({ is_active: false, subscription_status: 'paused' })
    .eq('id', tenantId);
  if (error) throw dbError(error, 'Could not pause the account');
}

async function reactivateTenant(db: FailedPaymentDb, tenantId: string): Promise<void> {
  const { error } = await db
    .from('tenants')
    .update({ is_active: true, subscription_status: 'active' })
    .eq('id', tenantId);
  if (error) throw dbError(error, 'Could not restart the account');
}

async function cancelTenant(db: FailedPaymentDb, tenantId: string): Promise<void> {
  const { error } = await db
    .from('tenants')
    .update({
      is_active: false,
      subscription_status: 'cancelled',
      has_landline: false,
      has_mobile: false,
      has_whatsapp: false,
    })
    .eq('id', tenantId);
  if (error) throw dbError(error, 'Could not cancel the account');

  const addons = await db
    .from('tenant_active_addons')
    .update({
      is_active: false,
      subscription_status: 'cancelled',
      deactivated_at: new Date().toISOString(),
      cancel_at_period_end: false,
      cancel_at: null,
    })
    .eq('tenant_id', tenantId);
  if (addons.error) throw dbError(addons.error, 'Could not cancel account add-ons');
}

async function markRecovered(db: FailedPaymentDb, caseId: string): Promise<void> {
  const { error } = await db
    .from('failed_payment_cases')
    .update({ status: 'recovered', updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('status', 'past_due')
    .is('paused_at', null);
  if (error) throw dbError(error, 'Could not recover the failed payment');
}

async function emitTransition(
  handler: FailedPaymentTransitionHandler | undefined,
  event: FailedPaymentTransitionEvent,
): Promise<void> {
  await (handler ?? onFailedPaymentTransition)(event);
}

export async function applyFailedPaymentTransition(
  db: FailedPaymentDb,
  row: FailedPaymentCaseRow,
  kind: DueFailedPaymentTransition | 'restart',
  now: Date,
  stripe: FailedPaymentStripeClient,
  onTransition?: FailedPaymentTransitionHandler,
): Promise<'applied' | 'skipped' | 'locked'> {
  const occurredAt = now.toISOString();
  const key = failedPaymentTransitionKey(kind, row.stripe_invoice_id);
  const claim = await claimTransition(db, row, kind, occurredAt);
  if (claim === 'skip') return 'skipped';
  if (claim === 'locked') return 'locked';

  const subscriptionId = (row.stripe_subscription_id || '').trim() || null;
  try {
    if (kind === 'pause') {
      await stripe.pauseCollection(requireSubscriptionId(row));
      await pauseTenant(db, row.tenant_id);
    } else if (kind === 'restart') {
      await stripe.restartBilling(requireSubscriptionId(row));
      await reactivateTenant(db, row.tenant_id);
    } else if (kind === 'cancel') {
      await stripe.cancelSubscription(requireSubscriptionId(row));
      await cancelTenant(db, row.tenant_id);
    } else {
      await stripe.writeOffInvoice(row.stripe_invoice_id);
    }
  } catch (error) {
    await completeTransition(db, key, false, {}).catch(() => undefined);
    throw error;
  }

  const detail = kind === 'restart'
    ? { billingCycleAnchor: 'now', prorationBehavior: 'none', billingRestartedAt: occurredAt }
    : kind === 'write_off'
      ? { writtenOffInvoiceId: row.stripe_invoice_id }
      : { stripeSubscriptionId: subscriptionId };

  await completeTransition(db, key, true, detail);
  await emitTransition(onTransition, {
    kind,
    tenantId: row.tenant_id,
    caseId: row.id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeSubscriptionId: subscriptionId,
    occurredAt,
    billingRestartedAt: kind === 'restart' ? occurredAt : null,
    writtenOffInvoiceId: kind === 'write_off' ? row.stripe_invoice_id : null,
  });
  return 'applied';
}

export async function settleFailedPaymentOnInvoicePaid(
  db: FailedPaymentDb,
  input: {
    settlement: FailedPaymentSettlement;
    now: Date;
    stripe?: FailedPaymentStripeClient;
    onTransition?: FailedPaymentTransitionHandler;
  },
): Promise<void> {
  if (input.settlement.action === 'recover') {
    await markRecovered(db, input.settlement.row.id);
    return;
  }
  if (input.settlement.action !== 'restart') return;

  const stripe = input.stripe ?? resolveFailedPaymentStripeClient();
  const outcome = await applyFailedPaymentTransition(
    db,
    input.settlement.row,
    'restart',
    input.now,
    stripe,
    input.onTransition,
  );
  if (outcome === 'locked') {
    throw new Error('Failed payment restart is still processing');
  }
}

export async function runFailedPaymentSweep(
  db: FailedPaymentDb,
  input: {
    now?: Date;
    stripe: FailedPaymentStripeClient;
    onTransition?: FailedPaymentTransitionHandler;
  },
): Promise<FailedPaymentSweepResult> {
  const now = input.now ?? new Date();
  const open = await db
    .from('failed_payment_cases')
    .select(CASE_COLUMNS)
    .in('status', ['past_due', 'paused'])
    .is('restarted_at', null)
    .is('cancelled_at', null);
  if (open.error) throw dbError(open.error, 'Could not list open failed payments');
  const unwound = await db
    .from('failed_payment_cases')
    .select(CASE_COLUMNS)
    .not('cancelled_at', 'is', null)
    .is('written_off_invoice_id', null);
  if (unwound.error) throw dbError(unwound.error, 'Could not list open failed payments');
  const seen = new Set<string>();
  const rows: FailedPaymentCaseRow[] = [];
  for (const row of [...(open.data || []), ...(unwound.data || [])] as FailedPaymentCaseRow[]) {
    if (seen.has(row.id)) continue;
    if (row.status === 'recovered' || row.status === 'restarted') continue;
    seen.add(row.id);
    rows.push(row);
  }
  const result: FailedPaymentSweepResult = { examined: rows.length, applied: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    const due = dueFailedPaymentTransitions(snapshotFromFailedPaymentCase(row), now);
    for (const kind of due) {
      try {
        const outcome = await applyFailedPaymentTransition(db, row, kind, now, input.stripe, input.onTransition);
        if (outcome === 'applied') {
          result.applied += 1;
          continue;
        }
        if (outcome === 'skipped') {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
        break;
      } catch (err) {
        result.failed += 1;
        console.error('[failed-payment] transition failed', {
          kind,
          caseId: row.id,
          message: err instanceof Error ? err.message : 'transition failed',
        });
        break;
      }
    }
  }

  return result;
}
