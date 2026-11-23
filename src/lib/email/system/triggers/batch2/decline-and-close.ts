import { isSystemEmailTenantId } from '../../data'
import { BATCH2_ACCOUNT_CLOSED, BATCH2_SIGNUP_DECLINED, formatBatch2Date } from '../../templates/batch-2'
import { loadAccountEmailContext } from './account'
import { sendBatch2Email, type Batch2SendResult } from './send'

const DECLINE_REASONS = new Set(['business_unverified', 'pricing_mistake', 'number_unavailable'])
const REFUND_REFERENCE = /^re_[A-Za-z0-9_]{4,80}$/

export type AccountActionResult =
  | {
      ok: true
      status: 200
      refund: 'recorded' | 'not_due'
      email: Batch2SendResult
    }
  | { ok: false; status: 400 | 404 | 422; message: string }

function recordedRefund(
  recorded: boolean | undefined,
  reference: string | undefined,
): { ok: true; reference: string } | { ok: false; status: 400; message: string } {
  if (recorded !== true) {
    return { ok: false, status: 400, message: 'Record the refund before sending this email.' }
  }
  const id = (reference || '').trim()
  if (!REFUND_REFERENCE.test(id)) {
    return { ok: false, status: 400, message: 'A refund reference starting with re_ is required.' }
  }
  return { ok: true, reference: id }
}

function wholePence(value: number | undefined, label: string): { ok: true; text: string } | { ok: false; status: 400; message: string } {
  if (value === undefined) return { ok: true, text: '' }
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) {
    return { ok: false, status: 400, message: label }
  }
  return { ok: true, text: String(value) }
}

export async function declineSignup(input: {
  tenantId: string
  reasonCode: string
  amountPaidPence?: number
  refundRecorded?: boolean
  refundReference?: string
}): Promise<AccountActionResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  if (!DECLINE_REASONS.has(input.reasonCode)) {
    return { ok: false, status: 400, message: 'A decline reason is required.' }
  }
  const paid = wholePence(input.amountPaidPence, 'The amount paid must be a whole number of pence.')
  if (!paid.ok) return paid
  const refund = recordedRefund(input.refundRecorded, input.refundReference)
  if (!refund.ok) return refund

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const email = await sendBatch2Email({
    templateKey: BATCH2_SIGNUP_DECLINED,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:signup-declined:${account.account.tenantId}`,
    data: {
      businessName: account.account.businessName,
      reasonCode: input.reasonCode,
      amountPaidPence: paid.text,
      refundRecorded: 'true',
      refundReference: refund.reference,
    },
  })
  return { ok: true, status: 200, refund: 'recorded', email }
}

export async function closeAccountNotABusiness(input: {
  tenantId: string
  accountClosed?: boolean
  unusedPeriodPence?: number
  unusedPeriodEnds?: string
  refundRecorded?: boolean
  refundReference?: string
}): Promise<AccountActionResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  if (input.accountClosed !== true) {
    return { ok: false, status: 400, message: 'Record that the account is already closed before sending this email.' }
  }
  const unused = wholePence(input.unusedPeriodPence, 'The unused period amount must be a whole number of pence.')
  if (!unused.ok) return unused
  if (input.unusedPeriodEnds && !formatBatch2Date(input.unusedPeriodEnds)) {
    return { ok: false, status: 400, message: 'The unused period end must be a calendar date.' }
  }
  const moneyDue = unused.text !== '' && Number(unused.text) > 0
  const refund = moneyDue ? recordedRefund(input.refundRecorded, input.refundReference) : { ok: true as const, reference: '' }
  if (!refund.ok) return refund

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const email = await sendBatch2Email({
    templateKey: BATCH2_ACCOUNT_CLOSED,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:account-closed:${account.account.tenantId}`,
    data: {
      businessName: account.account.businessName,
      accountClosed: 'true',
      unusedPeriodPence: unused.text,
      unusedPeriodEnds: input.unusedPeriodEnds || '',
      refundRecorded: refund.reference ? 'true' : '',
      refundReference: refund.reference,
    },
  })
  return { ok: true, status: 200, refund: refund.reference ? 'recorded' : 'not_due', email }
}
