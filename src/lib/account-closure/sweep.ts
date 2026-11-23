import type { SupabaseClient } from '@supabase/supabase-js';
import { isFailedPaymentFlowEnabled } from '@/lib/billing/failed-payment/flag';
import { deleteClosedAccountData } from '@/lib/account-closure/delete-data';
import { loadClosureNotice, sendClosureConfirmation, sendClosureReminder } from '@/lib/account-closure/closure-mail';
import { closurePhoneLabel, releaseHeldNumbers, type NumberReleaser } from '@/lib/account-closure/release';
import {
  ACCOUNT_CLOSURE_RETENTION_DAYS,
  type ClosureReason,
  formatClosureDate,
  isDeletionDue,
  isReminderDue,
  isReopenAllowed,
  closureMilestones,
} from '@/lib/account-closure/closure-clock';

export type AccountClosureRow = {
  id: string;
  tenant_id: string;
  reason: ClosureReason;
  source_key: string;
  closed_at: string;
  shadow_number: string | null;
  mobile_number: string | null;
  number_state: 'none' | 'held' | 'released';
  reminder_sent_at: string | null;
  deleted_at: string | null;
  released_at: string | null;
  confirmation_sent_at: string | null;
  reopened_at: string | null;
};

export type OpenClosureResult =
  | { ok: true; skipped: 'disabled' }
  | { ok: true; skipped: null; row: AccountClosureRow; created: boolean }
  | { ok: false; message: string };

export type ReopenClosureResult =
  | { ok: true; skipped: 'disabled' | 'none' | 'too_late' | 'already_deleted' }
  | { ok: true; skipped: null; closureId: string }
  | { ok: false; message: string };

export type AccountClosureSweepResult = {
  disabled?: boolean;
  examined: number;
  opened: number;
  reminders: number;
  deleted: number;
  released: number;
  confirmations: number;
  reopened: number;
  skipped: number;
  failed: number;
};

const CLOSURE_COLUMNS = 'id, tenant_id, reason, source_key, closed_at, shadow_number, mobile_number, number_state, reminder_sent_at, deleted_at, released_at, confirmation_sent_at, reopened_at';

function dbError(error: { message?: string } | null, fallback: string): Error {
  return new Error(error?.message || fallback);
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return String(error?.code || '') === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

async function readOpenClosure(db: SupabaseClient, tenantId: string): Promise<AccountClosureRow | null> {
  const { data, error } = await db
    .from('account_closures')
    .select(CLOSURE_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('reopened_at', null)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw dbError(error, 'Could not read the account closure');
  return (data as AccountClosureRow | null) ?? null;
}

async function readBySource(db: SupabaseClient, sourceKey: string): Promise<AccountClosureRow | null> {
  const { data, error } = await db
    .from('account_closures')
    .select(CLOSURE_COLUMNS)
    .eq('source_key', sourceKey)
    .maybeSingle();
  if (error) throw dbError(error, 'Could not read the account closure');
  return (data as AccountClosureRow | null) ?? null;
}

async function markNumbersHeld(db: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await db
    .from('tenant_phone_number_purchases')
    .update({ status: 'held', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'active', 'unknown']);
  if (error) throw dbError(error, 'Could not mark the number as held');
}

export async function openAccountClosure(
  db: SupabaseClient,
  input: {
    tenantId: string;
    reason: ClosureReason;
    closedAt: string;
    sourceKey: string;
  },
): Promise<OpenClosureResult> {
  if (!isFailedPaymentFlowEnabled()) return { ok: true, skipped: 'disabled' };
  const tenantId = input.tenantId.trim();
  const sourceKey = input.sourceKey.trim();
  const closedAt = new Date(input.closedAt);
  if (!tenantId || !sourceKey || !Number.isFinite(closedAt.getTime())) {
    return { ok: false, message: 'A tenant, a source and a close time are required.' };
  }

  const existingOpen = await readOpenClosure(db, tenantId);
  if (existingOpen) {
    if (existingOpen.number_state === 'held') await markNumbersHeld(db, tenantId);
    return { ok: true, skipped: null, row: existingOpen, created: false };
  }
  const existingSource = await readBySource(db, sourceKey);
  if (existingSource) return { ok: true, skipped: null, row: existingSource, created: false };

  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .select('id, twilio_shadow_number, twilio_mobile_number')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) return { ok: false, message: tenantError.message || 'Could not read the account' };
  if (!tenant) return { ok: false, message: 'That account was not found.' };

  const shadow = typeof tenant.twilio_shadow_number === 'string' ? tenant.twilio_shadow_number.trim() : '';
  const mobile = typeof tenant.twilio_mobile_number === 'string' ? tenant.twilio_mobile_number.trim() : '';
  const hasNumber = Boolean(shadow || mobile);
  const { data, error } = await db
    .from('account_closures')
    .insert({
      tenant_id: tenantId,
      reason: input.reason,
      source_key: sourceKey,
      closed_at: closedAt.toISOString(),
      shadow_number: shadow || null,
      mobile_number: mobile || null,
      number_state: hasNumber ? 'held' : 'none',
    })
    .select(CLOSURE_COLUMNS)
    .maybeSingle();
  if (error && isUniqueViolation(error)) {
    const raced = (await readOpenClosure(db, tenantId)) || (await readBySource(db, sourceKey));
    if (!raced) return { ok: false, message: 'The account closure was created but could not be read.' };
    return { ok: true, skipped: null, row: raced, created: false };
  }
  if (error || !data) return { ok: false, message: error?.message || 'Could not record the account closure' };
  if (hasNumber) await markNumbersHeld(db, tenantId);
  console.info('[account-closure] held', {
    tenantId,
    closureId: (data as AccountClosureRow).id,
    reason: input.reason,
    retentionDays: ACCOUNT_CLOSURE_RETENTION_DAYS,
    hasNumber,
  });
  return { ok: true, skipped: null, row: data as AccountClosureRow, created: true };
}

export async function reopenAccountClosure(
  db: SupabaseClient,
  tenantId: string,
  now: Date,
): Promise<ReopenClosureResult> {
  if (!isFailedPaymentFlowEnabled()) return { ok: true, skipped: 'disabled' };
  const open = await readOpenClosure(db, tenantId.trim());
  if (!open) return { ok: true, skipped: 'none' };
  if (open.deleted_at) return { ok: true, skipped: 'already_deleted' };
  if (!isReopenAllowed(new Date(open.closed_at), now)) return { ok: true, skipped: 'too_late' };

  const reopenedAt = now.toISOString();
  const { error } = await db
    .from('account_closures')
    .update({ reopened_at: reopenedAt, updated_at: reopenedAt })
    .eq('id', open.id)
    .is('reopened_at', null)
    .is('deleted_at', null);
  if (error) return { ok: false, message: error.message || 'Could not reopen the account' };

  if (open.number_state === 'held') {
    const { error: purchaseError } = await db
      .from('tenant_phone_number_purchases')
      .update({ status: 'active', updated_at: reopenedAt })
      .eq('tenant_id', open.tenant_id)
      .eq('status', 'held');
    if (purchaseError) return { ok: false, message: purchaseError.message || 'Could not restore the held number' };
  }
  console.info('[account-closure] reopened', { tenantId: open.tenant_id, closureId: open.id });
  return { ok: true, skipped: null, closureId: open.id };
}

async function stamp(db: SupabaseClient, id: string, patch: Record<string, string>): Promise<void> {
  const { error } = await db
    .from('account_closures')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw dbError(error, 'Could not update the account closure');
}

async function discoverFailedPaymentClosures(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('failed_payment_cases')
    .select('id, tenant_id, cancelled_at')
    .not('cancelled_at', 'is', null);
  if (error) throw dbError(error, 'Could not list cancelled failed payments');
  let opened = 0;
  for (const row of data || []) {
    if (!row.cancelled_at || !row.tenant_id) continue;
    const result = await openAccountClosure(db, {
      tenantId: row.tenant_id,
      reason: 'failed_payment',
      closedAt: row.cancelled_at,
      sourceKey: `failed-payment:${row.id}`,
    });
    if (!result.ok) throw new Error(result.message);
    if (result.skipped === null && result.created) opened += 1;
  }
  return opened;
}

async function discoverEndedTrials(db: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from('tenants')
    .select('id, trial_ends_at')
    .in('subscription_status', ['trialing', 'trial'])
    .lte('trial_ends_at', now.toISOString());
  if (error) throw dbError(error, 'Could not list ended trials');
  let opened = 0;
  for (const row of data || []) {
    if (!row.trial_ends_at || !row.id) continue;
    const result = await openAccountClosure(db, {
      tenantId: row.id,
      reason: 'trial_ended',
      closedAt: row.trial_ends_at,
      sourceKey: `trial:${row.id}:${row.trial_ends_at}`,
    });
    if (!result.ok) throw new Error(result.message);
    if (result.skipped === null && result.created) {
      opened += 1;
      const { error: closeError } = await db
        .from('tenants')
        .update({ is_active: false, subscription_status: 'cancelled' })
        .eq('id', row.id);
      if (closeError) throw dbError(closeError, 'Could not close the ended trial');
    }
  }
  return opened;
}

async function reopenActiveAccounts(db: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from('account_closures')
    .select('tenant_id')
    .is('reopened_at', null)
    .is('deleted_at', null);
  if (error) throw dbError(error, 'Could not list open account closures');
  let reopened = 0;
  for (const row of data || []) {
    const { data: tenant, error: tenantError } = await db
      .from('tenants')
      .select('is_active, subscription_status')
      .eq('id', row.tenant_id)
      .maybeSingle();
    if (tenantError) throw dbError(tenantError, 'Could not read the account');
    const status = String(tenant?.subscription_status || '');
    if (tenant?.is_active !== true || (status !== 'active' && status !== 'trialing')) continue;
    const result = await reopenAccountClosure(db, row.tenant_id, now);
    if (!result.ok) throw new Error(result.message);
    if (result.skipped === null) reopened += 1;
  }
  return reopened;
}

function noticeFacts(row: AccountClosureRow): {
  closedOn: string;
  deletionOn: string;
  hasNumber: boolean;
  phoneNumber: string;
} {
  const closedAt = new Date(row.closed_at);
  const hasNumber = row.number_state === 'held' || row.number_state === 'released';
  return {
    closedOn: formatClosureDate(closedAt),
    deletionOn: formatClosureDate(closureMilestones(closedAt).deletionAt),
    hasNumber,
    phoneNumber: closurePhoneLabel(row.shadow_number, row.mobile_number),
  };
}

async function listActionable(db: SupabaseClient): Promise<AccountClosureRow[]> {
  const open = await db
    .from('account_closures')
    .select(CLOSURE_COLUMNS)
    .is('reopened_at', null)
    .is('deleted_at', null);
  if (open.error) throw dbError(open.error, 'Could not list account closures');
  const confirming = await db
    .from('account_closures')
    .select(CLOSURE_COLUMNS)
    .is('reopened_at', null)
    .not('deleted_at', 'is', null)
    .is('confirmation_sent_at', null);
  if (confirming.error) throw dbError(confirming.error, 'Could not list deletion confirmations');
  return [...(open.data || []), ...(confirming.data || [])] as AccountClosureRow[];
}

export async function runAccountClosureSweep(
  db: SupabaseClient,
  input: { now?: Date; releaser?: NumberReleaser } = {},
): Promise<AccountClosureSweepResult> {
  const result: AccountClosureSweepResult = {
    examined: 0,
    opened: 0,
    reminders: 0,
    deleted: 0,
    released: 0,
    confirmations: 0,
    reopened: 0,
    skipped: 0,
    failed: 0,
  };
  if (!isFailedPaymentFlowEnabled()) {
    return { ...result, disabled: true };
  }

  const now = input.now ?? new Date();
  result.opened += await discoverFailedPaymentClosures(db);
  result.opened += await discoverEndedTrials(db, now);
  result.reopened += await reopenActiveAccounts(db, now);

  const rows = await listActionable(db);
  result.examined = rows.length;
  for (const row of rows) {
    try {
      const clock = {
        closedAt: row.closed_at,
        reminderSentAt: row.reminder_sent_at,
        deletedAt: row.deleted_at,
        reopenedAt: row.reopened_at,
      };
      if (isReminderDue(clock, now)) {
        const loaded = await loadClosureNotice(row.tenant_id, row.id, noticeFacts(row));
        if (!loaded.ok) throw new Error(loaded.message);
        const sent = await sendClosureReminder(loaded.notice);
        if (!sent.ok) throw new Error(sent.message);
        const sentAt = now.toISOString();
        await stamp(db, row.id, { reminder_sent_at: sentAt });
        row.reminder_sent_at = sentAt;
        result.reminders += 1;
      } else if (!row.deleted_at) {
        result.skipped += 1;
      }

      if (isDeletionDue({ ...clock, reminderSentAt: row.reminder_sent_at }, now)) {
        await deleteClosedAccountData(db, row.tenant_id);
        let releasedCount = 0;
        if (row.number_state === 'held' && !row.released_at) {
          const released = await releaseHeldNumbers(db, {
            tenantId: row.tenant_id,
            shadowNumber: row.shadow_number,
            mobileNumber: row.mobile_number,
            releaser: input.releaser,
          });
          releasedCount = released.released;
          result.released += releasedCount > 0 ? 1 : 0;
        }
        const deletedAt = now.toISOString();
        await stamp(db, row.id, {
          deleted_at: deletedAt,
          ...(row.number_state === 'held' ? { released_at: deletedAt, number_state: 'released' } : {}),
        });
        row.deleted_at = deletedAt;
        if (row.number_state === 'held') {
          row.released_at = deletedAt;
          row.number_state = 'released';
        }
        result.deleted += 1;
        console.info('[account-closure] deleted', {
          tenantId: row.tenant_id,
          closureId: row.id,
          releasedNumbers: releasedCount,
        });
      }

      if (row.deleted_at && !row.confirmation_sent_at && !row.reopened_at) {
        const loaded = await loadClosureNotice(row.tenant_id, row.id, noticeFacts(row));
        if (!loaded.ok) throw new Error(loaded.message);
        const sent = await sendClosureConfirmation(loaded.notice);
        if (!sent.ok) throw new Error(sent.message);
        const sentAt = now.toISOString();
        await stamp(db, row.id, { confirmation_sent_at: sentAt });
        row.confirmation_sent_at = sentAt;
        result.confirmations += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error('[account-closure] sweep failed', {
        closureId: row.id,
        message: error instanceof Error ? error.message : 'failed',
      });
    }
  }
  return result;
}
