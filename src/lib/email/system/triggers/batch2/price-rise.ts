import { isSystemEmailTenantId } from '../../data'
import {
  BATCH2_ANNUAL_PRICE_RISE,
  BATCH2_OTHER_PRICE_RISE,
  annualPriceRiseDashboardNotice,
  formatBatch2Pence,
  otherPriceRiseDashboardNotice,
} from '../../templates/batch-2'
import { loadAccountEmailContext } from './account'
import {
  annualPriceCapPercent,
  capExplanation,
  isAtLeastDaysBefore,
  isFirstOfApril,
  isIsoDate,
  priceAfterCapPence,
  startedAtLeastTwelveMonthsBefore,
} from './price-rules'
import { sendBatch2Email, type Batch2SendResult } from './send'

export type PriceLineInput = {
  label: string
  currentPence: number
  newPence?: number
}

export type PriceRiseResult =
  | {
      ok: true
      status: 200
      email: Batch2SendResult
      dashboardNotice: string
    }
  | { ok: false; status: 400 | 404 | 422; message: string }

function cleanLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').trim()
}

function validPence(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000_000
}

function todayIso(noticeDate?: string): string {
  if (noticeDate) return noticeDate
  return new Date().toISOString().slice(0, 10)
}

export async function sendAnnualPriceRiseNotice(input: {
  tenantId: string
  subscriptionStartedOn: string
  effectiveDate: string
  cpi12MonthPercent: number
  prices: PriceLineInput[]
  noticeDate?: string
}): Promise<PriceRiseResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  if (!isFirstOfApril(input.effectiveDate)) {
    return { ok: false, status: 400, message: 'The annual price change starts on 1 April.' }
  }
  const noticeDate = todayIso(input.noticeDate)
  if (!isIsoDate(noticeDate) || !isAtLeastDaysBefore(noticeDate, input.effectiveDate, 60)) {
    return { ok: false, status: 400, message: 'The annual notice must be at least 60 days before 1 April.' }
  }
  if (!startedAtLeastTwelveMonthsBefore(input.subscriptionStartedOn, input.effectiveDate)) {
    return { ok: false, status: 400, message: 'The annual adjustment does not apply in the first 12 months.' }
  }
  const cap = annualPriceCapPercent(input.cpi12MonthPercent)
  if (cap === null) {
    return { ok: false, status: 400, message: 'The CPI rate is not a usable 12-month figure.' }
  }
  if (cap === 0) {
    return { ok: false, status: 400, message: 'The Cap is zero or less, so there is no annual increase.' }
  }
  if (!input.prices.length) {
    return { ok: false, status: 400, message: 'At least one current price is required.' }
  }

  const lines: string[] = []
  for (const price of input.prices) {
    const label = cleanLabel(price.label || '')
    if (!label || label.length > 80 || !validPence(price.currentPence)) {
      return { ok: false, status: 400, message: 'Each price needs a name and a current amount in pence.' }
    }
    const next = priceAfterCapPence(price.currentPence, cap)
    if (next === null) {
      return { ok: false, status: 400, message: 'Each price needs a name and a current amount in pence.' }
    }
    lines.push(`${label}: ${formatBatch2Pence(String(price.currentPence))} to ${formatBatch2Pence(String(next))}`)
  }

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const data = {
    businessName: account.account.businessName,
    effectiveDate: input.effectiveDate,
    subscriptionStartedOn: input.subscriptionStartedOn,
    priceLines: lines.join('\n'),
    capExplanation: capExplanation(input.cpi12MonthPercent, cap),
    billingUrl: account.account.billingUrl,
  }
  const year = input.effectiveDate.slice(0, 4)
  const email = await sendBatch2Email({
    templateKey: BATCH2_ANNUAL_PRICE_RISE,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:annual-price-rise:${account.account.tenantId}:${year}`,
    data,
  })
  return {
    ok: true,
    status: 200,
    email,
    dashboardNotice: annualPriceRiseDashboardNotice(data),
  }
}

export async function sendOtherPriceRiseNotice(input: {
  tenantId: string
  effectiveDate: string
  howWorkedOut: string
  prices: PriceLineInput[]
  noticeDate?: string
}): Promise<PriceRiseResult> {
  if (!isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, status: 400, message: 'A tenant id is required.' }
  }
  if (!isIsoDate(input.effectiveDate)) {
    return { ok: false, status: 400, message: 'The new price needs a start date.' }
  }
  const noticeDate = todayIso(input.noticeDate)
  if (!isIsoDate(noticeDate) || !isAtLeastDaysBefore(noticeDate, input.effectiveDate, 60)) {
    return { ok: false, status: 400, message: 'Any other price increase needs at least 60 days notice.' }
  }
  const howWorkedOut = cleanLabel(input.howWorkedOut || '')
  if (!howWorkedOut || howWorkedOut.length > 300) {
    return { ok: false, status: 400, message: 'Say how the new price was worked out, in one short sentence.' }
  }
  if (!input.prices.length) {
    return { ok: false, status: 400, message: 'At least one price is required.' }
  }

  const lines: string[] = []
  for (const price of input.prices) {
    const label = cleanLabel(price.label || '')
    if (!label || label.length > 80 || !validPence(price.currentPence) || price.newPence === undefined || !validPence(price.newPence)) {
      return { ok: false, status: 400, message: 'Each price needs a name, the current amount and the new amount, in pence.' }
    }
    if (price.newPence <= price.currentPence) {
      return { ok: false, status: 400, message: 'A price-rise notice is only for a higher price.' }
    }
    lines.push(`${label}: ${formatBatch2Pence(String(price.currentPence))} to ${formatBatch2Pence(String(price.newPence))}`)
  }

  const account = await loadAccountEmailContext(input.tenantId)
  if (!account.ok) return account

  const data = {
    businessName: account.account.businessName,
    effectiveDate: input.effectiveDate,
    priceLines: lines.join('\n'),
    howWorkedOut,
    billingUrl: account.account.billingUrl,
  }
  const email = await sendBatch2Email({
    templateKey: BATCH2_OTHER_PRICE_RISE,
    tenantId: account.account.tenantId,
    to: account.account.email,
    idempotencyKey: `batch2:other-price-rise:${account.account.tenantId}:${input.effectiveDate}`,
    data,
  })
  return {
    ok: true,
    status: 200,
    email,
    dashboardNotice: otherPriceRiseDashboardNotice(data),
  }
}
