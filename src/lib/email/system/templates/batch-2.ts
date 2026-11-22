import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailContent, SystemEmailTemplate } from '../types'

/**
 * MERGE: package 4a and package 4b both replace the empty batch-2 array.
 * Keep every template and helper from both sides. Do not drop either list.
 */

/**
 * Package 4a: emails 2, 3, 22, 23 and the bolt-on added confirmation (STYL-278).
 * Wording is limited to the 19 Oct 2026 Terms redraft (clauses 0.3, 0.4, 4.1A and 4B).
 * Emails 6-9 and 20 are in package 4b.
 */

export const BATCH2_SIGNUP_DECLINED = 'system.batch2.signup-declined'
export const BATCH2_ACCOUNT_CLOSED = 'system.batch2.account-closed-not-a-business'
export const BATCH2_ANNUAL_PRICE_RISE = 'system.batch2.annual-price-rise'
export const BATCH2_OTHER_PRICE_RISE = 'system.batch2.other-price-rise'
export const BATCH2_BOLT_ON_ADDED = 'system.batch2.bolt-on-added'

const BILLING_LABEL = 'Open billing'

const CANCEL_RIGHTS =
  "If you don't want to pay the new price, you can cancel your subscription, or remove just the bolt-on whose price is changing, at any time before it takes effect. There is no fee, and you won't be charged the new price. Your subscription or bolt-on ends at the end of the billing month you have already paid for."

const DECLINE_REASONS: Record<string, string> = {
  business_unverified: "We can't verify your business.",
  pricing_mistake: 'There is an obvious mistake in a price or description.',
  number_unavailable: "Our telecoms provider can't supply a number you have chosen.",
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatBatch2Pence(pence: string | undefined): string {
  const raw = pence?.trim() || ''
  if (!/^\d+$/.test(raw)) return ''
  const value = Number(raw)
  const pounds = Math.floor(value / 100)
  const rest = value % 100
  return `£${pounds}.${String(rest).padStart(2, '0')}`
}

export function formatBatch2Date(iso: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso?.trim() || '')
  if (!match) return ''
  const month = MONTHS[Number(match[2]) - 1]
  if (!month) return ''
  const day = Number(match[3])
  if (day < 1 || day > 31) return ''
  return `${day} ${month} ${match[1]}`
}

function clean(value: string | undefined): string {
  return (value || '').replace(/[\r\n]+/g, ' ').trim()
}

function httpsUrl(value: string | undefined): string | undefined {
  const trimmed = clean(value)
  if (!/^https:\/\/[^\s]+$/.test(trimmed)) return undefined
  return trimmed
}

function branded(input: {
  subject: string
  subtitle: string
  paragraphs: string[]
  billingUrl?: string
}): SystemEmailContent {
  const billingUrl = httpsUrl(input.billingUrl)
  return renderBrandedSystemEmail({
    subject: input.subject,
    title: 'StyleFlo',
    subtitle: input.subtitle,
    paragraphs: input.paragraphs.filter((paragraph) => paragraph.trim().length > 0),
    ctaHref: billingUrl,
    ctaLabel: billingUrl ? BILLING_LABEL : undefined,
  })
}

function business(data: Record<string, string>): string {
  return clean(data.businessName) || 'your business'
}

function template(
  key: string,
  sampleData: Record<string, string>,
  render: (data: Record<string, string>) => SystemEmailContent,
): SystemEmailTemplate {
  return { key, sampleData, render }
}

function declineReason(data: Record<string, string>): string {
  return DECLINE_REASONS[clean(data.reasonCode)] || ''
}

function priceLines(data: Record<string, string>): string[] {
  return (data.priceLines || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function annualPriceRiseParagraphs(data: Record<string, string>): string[] {
  const effective = formatBatch2Date(data.effectiveDate) || '1 April'
  const started = formatBatch2Date(data.subscriptionStartedOn)
  const startedSentence = started
    ? ` Your subscription started on ${started}, which is at least 12 months before ${effective}.`
    : ''
  return [
    `Hello,`,
    `We are increasing the monthly price of the StyleFlo plan and bolt-ons for ${business(data)} from ${effective}. This is the annual price adjustment. This notice is at least 60 days before that date.${startedSentence}`,
    ...priceLines(data),
    clean(data.capExplanation),
    CANCEL_RIGHTS,
  ]
}

export function otherPriceRiseParagraphs(data: Record<string, string>): string[] {
  const effective = formatBatch2Date(data.effectiveDate) || clean(data.effectiveDate)
  return [
    `Hello,`,
    `We are increasing the price of the existing StyleFlo plan or bolt-ons for ${business(data)}. The new price starts on ${effective}. This notice is at least 60 days before that date.`,
    ...priceLines(data),
    clean(data.howWorkedOut) ? `How this was worked out: ${clean(data.howWorkedOut)}` : '',
    CANCEL_RIGHTS,
    'Changing your plan, or adding a bolt-on or a pack, is not a price increase.',
  ]
}

export function annualPriceRiseDashboardNotice(data: Record<string, string>): string {
  return annualPriceRiseParagraphs(data).filter((paragraph) => paragraph.trim()).join('\n\n')
}

export function otherPriceRiseDashboardNotice(data: Record<string, string>): string {
  return otherPriceRiseParagraphs(data).filter((paragraph) => paragraph.trim()).join('\n\n')
}

function refundReference(data: Record<string, string>): string {
  if (clean(data.refundRecorded) !== 'true') return ''
  const reference = clean(data.refundReference)
  if (!/^re_[A-Za-z0-9_]{4,80}$/.test(reference)) return ''
  return reference
}

function signupDeclined(data: Record<string, string>): SystemEmailContent {
  const reference = refundReference(data)
  const amount = formatBatch2Pence(data.amountPaidPence)
  const refund = !reference
    ? ''
    : amount
      ? `We have started a refund of everything you have paid (${amount}). The refund reference is ${reference}.`
      : `We have started a refund of everything you have paid. The refund reference is ${reference}.`
  return branded({
    subject: 'Your StyleFlo sign-up has been declined',
    subtitle: 'Sign-up declined',
    paragraphs: [
      'Hello,',
      `We have declined the StyleFlo sign-up for ${business(data)}.`,
      declineReason(data),
      'Our contract has not started. The contract starts only when the first payment goes through and we email you to confirm the account.',
      refund,
    ],
  })
}

function accountClosed(data: Record<string, string>): SystemEmailContent {
  const closed = clean(data.accountClosed) === 'true'
  const reference = refundReference(data)
  const unused = formatBatch2Pence(data.unusedPeriodPence)
  const refund = !reference
    ? ''
    : unused
      ? `We have started a refund of what has been paid for any period not yet used (${unused}). The refund reference is ${reference}.`
      : `We have started a refund of what has been paid for any period not yet used. The refund reference is ${reference}.`
  const periodEnd = formatBatch2Date(data.unusedPeriodEnds)
  return branded({
    subject: 'Your StyleFlo account has been closed',
    subtitle: 'Account closed',
    paragraphs: [
      'Hello,',
      closed
        ? `We have closed the StyleFlo account for ${business(data)} because it is not being used for a business.`
        : '',
      closed
        ? 'StyleFlo is for businesses, such as salons, barbers, spas and clinics. It is not for personal use.'
        : '',
      refund,
      reference && periodEnd ? `The unused period runs to ${periodEnd}.` : '',
      closed
        ? 'After the account closes we keep the data for 30 days, so you can ask for a copy. We then delete it. We may keep billing records for as long as the law requires.'
        : '',
    ],
  })
}

function annualPriceRise(data: Record<string, string>): SystemEmailContent {
  const effective = formatBatch2Date(data.effectiveDate) || '1 April'
  return branded({
    subject: `StyleFlo price change from ${effective}`,
    subtitle: 'Annual price change',
    billingUrl: data.billingUrl,
    paragraphs: annualPriceRiseParagraphs(data),
  })
}

function otherPriceRise(data: Record<string, string>): SystemEmailContent {
  return branded({
    subject: 'StyleFlo price change',
    subtitle: 'Price change',
    billingUrl: data.billingUrl,
    paragraphs: otherPriceRiseParagraphs(data),
  })
}

function boltOnAdded(data: Record<string, string>): SystemEmailContent {
  const name = clean(data.boltOnName) || 'bolt-on'
  const monthly = formatBatch2Pence(data.monthlyPricePence)
  const partMonth = formatBatch2Pence(data.partMonthChargePence)
  const nextBilling = formatBatch2Date(data.nextBillingDate)
  return branded({
    subject: `StyleFlo bolt-on added: ${name}`,
    subtitle: 'Bolt-on added',
    billingUrl: data.billingUrl,
    paragraphs: [
      'Hello,',
      `The ${name} bolt-on has been added to the StyleFlo account for ${business(data)}.`,
      monthly ? `The monthly price is ${monthly}.` : '',
      partMonth
        ? `The charge for the rest of this billing month, worked out pro rata, is ${partMonth}. It is taken straight away.`
        : 'If the bolt-on was added part-way through a billing month, the charge for the rest of that month is worked out pro rata and taken straight away.',
      nextBilling
        ? `From the next billing date, ${nextBilling}, the monthly payment includes the full price of the bolt-on.`
        : 'From the next billing date, the monthly payment includes the full price of the bolt-on.',
    ],
  })
}

const BILLING = 'https://staging.styleflo.ai/dashboard?tab=billing'

export const batch2Templates: readonly SystemEmailTemplate[] = [
  template(BATCH2_SIGNUP_DECLINED, {
      businessName: 'Harbour Salon',
      reasonCode: 'business_unverified',
      amountPaidPence: '999',
      refundRecorded: 'true',
      refundReference: 're_batch2_decline',
    }, signupDeclined),
  template(BATCH2_ACCOUNT_CLOSED, {
      businessName: 'Harbour Salon',
      unusedPeriodPence: '499',
      unusedPeriodEnds: '2027-04-01',
      accountClosed: 'true',
      refundRecorded: 'true',
      refundReference: 're_batch2_close',
    }, accountClosed),
  template(BATCH2_ANNUAL_PRICE_RISE, {
      businessName: 'Harbour Salon',
      effectiveDate: '2027-04-01',
      subscriptionStartedOn: '2025-04-01',
      priceLines: 'Foundation: £9.99 to £10.51\nGoogle Calendar: £4.99 to £5.25',
      capExplanation:
        'The Cap is the 12-month rate of the Consumer Prices Index (CPI) last published by the Office for National Statistics before this notice (3.2%), plus 2 percentage points. That comes to 5.2%. The Cap is never more than 8%. We worked out the increase separately for the plan and each bolt-on, and rounded each new price to the nearest penny.',
      billingUrl: BILLING,
    }, annualPriceRise),
  template(BATCH2_OTHER_PRICE_RISE, {
      businessName: 'Harbour Salon',
      effectiveDate: '2027-06-01',
      priceLines: 'Foundation: £9.99 to £10.99',
      howWorkedOut: 'The monthly Foundation price is increasing by £1.00.',
      billingUrl: BILLING,
    }, otherPriceRise),
  template(BATCH2_BOLT_ON_ADDED, {
      businessName: 'Harbour Salon',
      boltOnName: 'Google Calendar',
      monthlyPricePence: '499',
      partMonthChargePence: '250',
      nextBillingDate: '2027-04-02',
      billingUrl: BILLING,
    }, boltOnAdded),
]
