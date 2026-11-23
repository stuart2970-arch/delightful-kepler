import { isSystemEmailTenantId } from '../../data'
import {
  BATCH2_AUTO_TOPUP_LIMIT,
  BATCH2_AUTO_TOPUP_PAYMENT,
  BATCH2_AUTO_TOPUP_RECEIPT,
  BATCH2_PACK_PRICE_CHANGE,
  BATCH2_PORTING_COMPLETED,
  BATCH2_PORTING_FAILED,
  BATCH2_PORTING_HELD,
  BATCH2_PORTING_RECEIVED,
  formatBatch2Date,
} from '../../templates/batch-2'
import { loadAccountEmailContext, type AccountEmailFailure } from './account'
import { isAtLeastDaysBefore, isIsoDate } from './price-rules'
import { sendBatch2Email, type Batch2SendResult } from './send'

/**
 * Emails 6-9 and 20. The purchase and supplier-port events are not in the
 * app yet, so production does not call these. The functions are ready.
 */

const PORT_TEMPLATES = {
  received: BATCH2_PORTING_RECEIVED,
  held: BATCH2_PORTING_HELD,
  completed: BATCH2_PORTING_COMPLETED,
  failed: BATCH2_PORTING_FAILED,
} as const

export type DeferredSendResult =
  | { ok: true; status: 200; email: Batch2SendResult }
  | AccountEmailFailure

function token(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80)
}

function pence(value: number | undefined): boolean {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 10_000_000
}

async function sendForAccount(input: {
  tenantId: string
  templateKey: string
  idempotencyKey: string
  data: Record<string, string>
  billing?: boolean
}): Promise<DeferredSendResult> {
  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account
  const email = await sendBatch2Email({
    templateKey: input.templateKey,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: input.idempotencyKey,
    data: {
      ...input.data,
      businessName: account.account.businessName,
      billingUrl: input.billing === false ? '' : account.account.billingUrl,
    },
  })
  return { ok: true, status: 200, email }
}

export async function sendAutoTopupReceipt(input: {
  tenantId: string
  chargeId: string
  purchasedOn: string
  packName: string
  amountPence: number
}): Promise<DeferredSendResult> {
  const chargeId = token(input.chargeId)
  if (!isSystemEmailTenantId(input.tenantId) || !chargeId || !formatBatch2Date(input.purchasedOn) || !input.packName.trim() || !pence(input.amountPence)) {
    return { ok: false, status: 400, message: 'A receipt needs the account, charge, date, pack and amount.' }
  }
  return sendForAccount({
    tenantId: input.tenantId,
    templateKey: BATCH2_AUTO_TOPUP_RECEIPT,
    idempotencyKey: `batch2:auto-topup-receipt:${input.tenantId}:${chargeId}`,
    data: {
      purchasedOn: input.purchasedOn,
      packName: input.packName.trim(),
      amountPence: String(input.amountPence),
    },
  })
}

export async function sendAutoTopupLimitReached(input: {
  tenantId: string
  billingMonth: string
  limitDescription?: string
  nextBillingDate?: string
}): Promise<DeferredSendResult> {
  if (!isSystemEmailTenantId(input.tenantId) || !/^\d{4}-\d{2}$/.test(input.billingMonth)) {
    return { ok: false, status: 400, message: 'A monthly limit notice needs the account and the billing month.' }
  }
  if (input.nextBillingDate && !formatBatch2Date(input.nextBillingDate)) {
    return { ok: false, status: 400, message: 'The next billing date must be a calendar date.' }
  }
  return sendForAccount({
    tenantId: input.tenantId,
    templateKey: BATCH2_AUTO_TOPUP_LIMIT,
    idempotencyKey: `batch2:auto-topup-limit:${input.tenantId}:${input.billingMonth}`,
    data: {
      limitDescription: (input.limitDescription || '').replace(/[\r\n]+/g, ' ').trim(),
      nextBillingDate: input.nextBillingDate || '',
    },
  })
}

export async function sendAutoTopupPaymentNeedsAction(input: {
  tenantId: string
  paymentId: string
  paymentState: 'failed' | 'needs_confirmation'
  packName?: string
  amountPence?: number
}): Promise<DeferredSendResult> {
  const paymentId = token(input.paymentId)
  if (!isSystemEmailTenantId(input.tenantId) || !paymentId || (input.paymentState !== 'failed' && input.paymentState !== 'needs_confirmation')) {
    return { ok: false, status: 400, message: 'A payment notice needs the account, the payment and what happened.' }
  }
  if (input.amountPence !== undefined && !pence(input.amountPence)) {
    return { ok: false, status: 400, message: 'The amount must be a whole number of pence.' }
  }
  return sendForAccount({
    tenantId: input.tenantId,
    templateKey: BATCH2_AUTO_TOPUP_PAYMENT,
    idempotencyKey: `batch2:auto-topup-payment:${input.tenantId}:${paymentId}`,
    data: {
      paymentState: input.paymentState,
      packName: (input.packName || '').trim(),
      amountPence: input.amountPence === undefined ? '' : String(input.amountPence),
    },
  })
}

export async function sendPackPriceChangeNotice(input: {
  tenantId: string
  packId: string
  packName: string
  currentPricePence: number
  newPricePence: number
  firstBuyDate: string
  noticeDate?: string
}): Promise<DeferredSendResult> {
  const packId = token(input.packId)
  const noticeDate = input.noticeDate || new Date().toISOString().slice(0, 10)
  if (!isSystemEmailTenantId(input.tenantId) || !packId || !input.packName.trim() || !pence(input.currentPricePence) || !pence(input.newPricePence) || input.newPricePence <= input.currentPricePence) {
    return { ok: false, status: 400, message: 'A pack price notice needs a higher new price.' }
  }
  if (!isIsoDate(noticeDate) || !isIsoDate(input.firstBuyDate) || !isAtLeastDaysBefore(noticeDate, input.firstBuyDate, 30)) {
    return { ok: false, status: 400, message: 'The pack price notice must be at least 30 days before the first purchase at the new price.' }
  }
  return sendForAccount({
    tenantId: input.tenantId,
    templateKey: BATCH2_PACK_PRICE_CHANGE,
    idempotencyKey: `batch2:pack-price:${input.tenantId}:${packId}:${input.firstBuyDate}`,
    data: {
      packName: input.packName.trim(),
      currentPricePence: String(input.currentPricePence),
      newPricePence: String(input.newPricePence),
      firstBuyDate: input.firstBuyDate,
    },
  })
}

export async function sendPortingConfirmation(input: {
  tenantId: string
  status: keyof typeof PORT_TEMPLATES
  requestId: string
  numberKind: 'landline' | 'mobile'
  phoneNumber: string
}): Promise<DeferredSendResult> {
  const requestId = token(input.requestId)
  const phoneNumber = input.phoneNumber.replace(/[\r\n]+/g, ' ').trim()
  if (!isSystemEmailTenantId(input.tenantId) || !requestId || !PORT_TEMPLATES[input.status]) {
    return { ok: false, status: 400, message: 'A porting notice needs the account, the request and the status.' }
  }
  if ((input.numberKind !== 'landline' && input.numberKind !== 'mobile') || !phoneNumber || phoneNumber.length > 24) {
    return { ok: false, status: 400, message: 'Say whether the number is a landline or a mobile, and which number it is.' }
  }
  return sendForAccount({
    tenantId: input.tenantId,
    templateKey: PORT_TEMPLATES[input.status],
    idempotencyKey: `batch2:porting:${input.status}:${input.tenantId}:${requestId}`,
    billing: false,
    data: { numberKind: input.numberKind, phoneNumber },
  })
}
