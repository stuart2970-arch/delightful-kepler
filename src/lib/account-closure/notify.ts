import { sendSystemEmail } from '@/lib/email/system/send-system-email';
import { loadAccountEmailContext } from '@/lib/email/system/triggers/batch2/account';
import {
  BATCH1_CLOSURE_DELETED,
  BATCH1_CLOSURE_REMINDER,
} from '@/lib/email/system/templates/batch-1';

export type ClosureNotice = {
  closureId: string;
  tenantId: string;
  businessName: string;
  to: string;
  closedOn: string;
  deletionOn: string;
  hasNumber: boolean;
  phoneNumber: string;
};

export type ClosureNoticeResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; message: string };

async function sendClosureNotice(
  notice: ClosureNotice,
  templateKey: string,
  idempotencyKey: string,
): Promise<ClosureNoticeResult> {
  const result = await sendSystemEmail({
    templateKey,
    tenantId: notice.tenantId,
    to: notice.to,
    idempotencyKey,
    data: {
      businessName: notice.businessName,
      closedOn: notice.closedOn,
      deletionOn: notice.deletionOn,
      hasNumber: notice.hasNumber ? 'true' : 'false',
      phoneNumber: notice.phoneNumber,
    },
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, duplicate: result.duplicate };
}

export async function loadClosureNotice(
  tenantId: string,
  closureId: string,
  facts: { closedOn: string; deletionOn: string; hasNumber: boolean; phoneNumber: string },
): Promise<{ ok: true; notice: ClosureNotice } | { ok: false; message: string }> {
  const account = await loadAccountEmailContext(tenantId);
  if (!account.ok) return { ok: false, message: account.message };
  return {
    ok: true,
    notice: {
      closureId,
      tenantId,
      businessName: account.account.businessName,
      to: account.account.email,
      closedOn: facts.closedOn,
      deletionOn: facts.deletionOn,
      hasNumber: facts.hasNumber,
      phoneNumber: facts.phoneNumber,
    },
  };
}

export function sendClosureReminder(notice: ClosureNotice): Promise<ClosureNoticeResult> {
  return sendClosureNotice(notice, BATCH1_CLOSURE_REMINDER, `closure:reminder:${notice.closureId}`);
}

export function sendClosureConfirmation(notice: ClosureNotice): Promise<ClosureNoticeResult> {
  return sendClosureNotice(notice, BATCH1_CLOSURE_DELETED, `closure:confirmation:${notice.closureId}`);
}
