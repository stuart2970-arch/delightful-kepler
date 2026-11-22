import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailContent, SystemEmailTemplate } from '../types'

/**
 * MERGE: package 4a and package 4b both replace the empty batch-2 array.
 * Keep every template and helper from both sides. Do not drop either list.
 */

/**
 * Package 4b: emails 6-9 and 20. Templates are ready. Nothing in production
 * calls the senders yet, because auto top-up purchases and number-port events
 * are not in the app. Wording is limited to the 19 Oct 2026 Terms redraft
 * (clauses 4.5, 2C.6 and 3.6). The pack-price notice uses 30 days, which
 * STYL-263 records as the redraft figure for clause 4.5(h). Bracketed Terms
 * wording is not used.
 */

export const BATCH2_AUTO_TOPUP_RECEIPT = 'system.batch2.auto-topup-receipt'
export const BATCH2_AUTO_TOPUP_LIMIT = 'system.batch2.auto-topup-limit'
export const BATCH2_AUTO_TOPUP_PAYMENT = 'system.batch2.auto-topup-payment'
export const BATCH2_PACK_PRICE_CHANGE = 'system.batch2.pack-price-change'
export const BATCH2_PORTING_RECEIVED = 'system.batch2.porting-received'
export const BATCH2_PORTING_HELD = 'system.batch2.porting-held'
export const BATCH2_PORTING_COMPLETED = 'system.batch2.porting-completed'
export const BATCH2_PORTING_FAILED = 'system.batch2.porting-failed'

const BILLING_LABEL = 'Open billing'

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

function numberPhrase(data: Record<string, string>): string {
  const kind = clean(data.numberKind) === 'mobile' ? 'UK mobile number' : 'UK landline number'
  const number = clean(data.phoneNumber)
  return number ? `StyleFlo ${kind} ${number}` : `StyleFlo ${kind}`
}

function autoTopupReceipt(data: Record<string, string>): SystemEmailContent {
  const when = formatBatch2Date(data.purchasedOn) || clean(data.purchasedOn)
  const pack = clean(data.packName) || 'a pack'
  const amount = formatBatch2Pence(data.amountPence) || clean(data.amountPence)
  return branded({
    subject: 'StyleFlo auto top-up receipt',
    subtitle: 'Auto top-up receipt',
    billingUrl: data.billingUrl,
    paragraphs: [
      'Hello,',
      `This is a receipt for an automatic top-up on the StyleFlo account for ${business(data)}.`,
      when ? `Date: ${when}.` : '',
      `Pack: ${pack}.`,
      amount ? `Amount: ${amount}.` : '',
      'The payment was charged to the card saved on the account.',
      'The pack lasts 3 months from the date it was bought. It is used only after the monthly allowance has run out. Packs are not refundable, except where the law requires otherwise.',
      'This top-up also appears with the invoices in the billing section of the dashboard.',
    ],
  })
}

function autoTopupLimit(data: Record<string, string>): SystemEmailContent {
  const next = formatBatch2Date(data.nextBillingDate)
  const limit = clean(data.limitDescription)
  return branded({
    subject: 'StyleFlo auto top-up has reached its monthly limit',
    subtitle: 'Auto top-up limit',
    billingUrl: data.billingUrl,
    paragraphs: [
      'Hello,',
      `Auto top-up on the StyleFlo account for ${business(data)} has reached its monthly limit.`,
      limit ? `The limit that was reached: ${limit}.` : '',
      next
        ? `Auto top-up will not buy another pack until the next billing month, which starts on ${next}.`
        : 'Auto top-up will not buy another pack until the next billing month.',
    ],
  })
}

function autoTopupPayment(data: Record<string, string>): SystemEmailContent {
  const needsConfirmation = clean(data.paymentState) === 'needs_confirmation'
  const opening = needsConfirmation
    ? 'Your bank has asked you to confirm an automatic top-up payment.'
    : 'An automatic top-up payment did not go through.'
  const pack = clean(data.packName)
  const amount = formatBatch2Pence(data.amountPence)
  return branded({
    subject: needsConfirmation
      ? 'StyleFlo auto top-up payment needs confirmation'
      : 'StyleFlo auto top-up payment did not go through',
    subtitle: 'Auto top-up payment',
    billingUrl: data.billingUrl,
    paragraphs: [
      'Hello,',
      `${opening} This is for the StyleFlo account for ${business(data)}.`,
      pack ? `Pack: ${pack}.` : '',
      amount ? `Amount: ${amount}.` : '',
      'No pack has been added. A pack is added only when the payment goes through.',
      'A failed top-up does not pause the account.',
      'You can update the card in the billing section of the dashboard.',
    ],
  })
}

function packPriceChange(data: Record<string, string>): SystemEmailContent {
  const pack = clean(data.packName) || 'this pack'
  const current = formatBatch2Pence(data.currentPricePence)
  const next = formatBatch2Pence(data.newPricePence)
  const firstBuy = formatBatch2Date(data.firstBuyDate)
  const prices = current && next ? ` The price changes from ${current} to ${next}.` : ''
  return branded({
    subject: 'StyleFlo pack price change',
    subtitle: 'Pack price change',
    billingUrl: data.billingUrl,
    paragraphs: [
      'Hello,',
      `The price of ${pack} on the StyleFlo account for ${business(data)} is changing.${prices}`,
      firstBuy
        ? `Auto top-up will not buy this pack at the new price before ${firstBuy}.`
        : 'Auto top-up will not buy this pack at the new price until the date in this notice.',
      'This notice is at least 30 days before auto top-up first buys a pack at the new price. You can turn auto top-up off, or change the auto top-up settings, in the dashboard before then.',
      'The price of a pack that has already been bought does not change.',
    ],
  })
}

function porting(status: 'received' | 'held' | 'completed' | 'failed', data: Record<string, string>): SystemEmailContent {
  const phrase = numberPhrase(data)
  const businessName = business(data)
  if (status === 'received') {
    return branded({
      subject: 'Your StyleFlo number port request has been received',
      subtitle: 'Number port',
      paragraphs: [
        'Hello,',
        `We have received a request to move (port) the ${phrase} for ${businessName} to another provider.`,
        'We will release the number to that provider.',
      ],
    })
  }
  if (status === 'held') {
    return branded({
      subject: 'Your StyleFlo number is held while a port is in progress',
      subtitle: 'Number port',
      paragraphs: [
        'Hello,',
        `A port of the ${phrase} for ${businessName} is in progress.`,
        'The number was due to be released. We will keep it until the port completes.',
      ],
    })
  }
  if (status === 'completed') {
    return branded({
      subject: 'Your StyleFlo number port has completed',
      subtitle: 'Number port',
      paragraphs: [
        'Hello,',
        `The port of the ${phrase} for ${businessName} has completed.`,
        'We have released the number to the new provider. It is no longer a StyleFlo number.',
      ],
    })
  }
  return branded({
    subject: 'Your StyleFlo number port did not complete',
    subtitle: 'Number port',
    paragraphs: [
      'Hello,',
      `The port of the ${phrase} for ${businessName} did not complete.`,
      'The number is still a StyleFlo number.',
    ],
  })
}

const BILLING = 'https://staging.styleflo.ai/dashboard?tab=billing'

export const batch2Templates: readonly SystemEmailTemplate[] = [
  template(BATCH2_AUTO_TOPUP_RECEIPT, {
      businessName: 'Harbour Salon',
      purchasedOn: '2027-03-02',
      packName: '30 voice minutes',
      amountPence: '1499',
      billingUrl: BILLING,
    }, autoTopupReceipt),
  template(BATCH2_AUTO_TOPUP_LIMIT, {
      businessName: 'Harbour Salon',
      limitDescription: 'the monthly limit set on the account',
      nextBillingDate: '2027-04-02',
      billingUrl: BILLING,
    }, autoTopupLimit),
  template(BATCH2_AUTO_TOPUP_PAYMENT, {
      businessName: 'Harbour Salon',
      paymentState: 'needs_confirmation',
      packName: '30 voice minutes',
      amountPence: '1499',
      billingUrl: BILLING,
    }, autoTopupPayment),
  template(BATCH2_PACK_PRICE_CHANGE, {
      businessName: 'Harbour Salon',
      packName: '30 voice minutes',
      currentPricePence: '1499',
      newPricePence: '1599',
      firstBuyDate: '2027-04-15',
      billingUrl: BILLING,
    }, packPriceChange),
  template(BATCH2_PORTING_RECEIVED, {
      businessName: 'Harbour Salon',
      numberKind: 'landline',
      phoneNumber: '01632 960123',
    }, (data) => porting('received', data)),
  template(BATCH2_PORTING_HELD, {
      businessName: 'Harbour Salon',
      numberKind: 'mobile',
      phoneNumber: '07700 900123',
    }, (data) => porting('held', data)),
  template(BATCH2_PORTING_COMPLETED, {
      businessName: 'Harbour Salon',
      numberKind: 'landline',
      phoneNumber: '01632 960123',
    }, (data) => porting('completed', data)),
  template(BATCH2_PORTING_FAILED, {
      businessName: 'Harbour Salon',
      numberKind: 'mobile',
      phoneNumber: '07700 900123',
    }, (data) => porting('failed', data)),
]
