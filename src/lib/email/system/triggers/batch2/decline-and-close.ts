import { isSystemEmailTenantId } from '../../data'
import { BATCH2_ACCOUNT_CLOSED, BATCH2_SIGNUP_DECLINED, formatBatch2Date } from '../../templates/batch-2'
import { loadAccountEmailContext } from './account'
import { sendBatch2Email, type Batch2SendResult } from './send'

const DECLINE_REASONS = new Set(['business_unverified', 'pricing_mistake', 'number_unavailable'])

export type AccountActionResult =
  | {
      ok: true
      status: 200
      refund: 'not_run'
      email: Batch2SendResult
    }
  | { ok: false; status: 400 | 404 | 422; message: string }

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
}): Promise<AccountActionResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  if (!DECLINE_REASONS.has(input.reasonCode)) {
    return { ok: false, status: 400, message: 'A decline reason is required.' }
  }
  const paid = wholePence(input.amountPaidPence, 'The amount paid must be a whole number of pence.')
  if (!paid.ok) return paid

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
    },
  })
  return { ok: true, status: 200, refund: 'not_run', email }
}

export async function closeAccountNotABusiness(input: {
  tenantId: string
  unusedPeriodPence?: number
  unusedPeriodEnds?: string
}): Promise<AccountActionResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  const unused = wholePence(input.unusedPeriodPence, 'The unused period amount must be a whole number of pence.')
  if (!unused.ok) return unused
  if (input.unusedPeriodEnds && !formatBatch2Date(input.unusedPeriodEnds)) {
    return { ok: false, status: 400, message: 'The unused period end must be a calendar date.' }
  }

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const email = await sendBatch2Email({
    templateKey: BATCH2_ACCOUNT_CLOSED,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:account-closed:${account.account.tenantId}`,
    data: {
      businessName: account.account.businessName,
      unusedPeriodPence: unused.text,
      unusedPeriodEnds: input.unusedPeriodEnds || '',
    },
  })
  return { ok: true, status: 200, refund: 'not_run', email }
}
