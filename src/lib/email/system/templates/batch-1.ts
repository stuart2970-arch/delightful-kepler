import { renderBrandedSystemEmail } from '../layout'
import type { SystemEmailContent, SystemEmailTemplate } from '../types'

export const BATCH1_CLOSURE_REMINDER = 'system.batch1.closure-reminder'
export const BATCH1_CLOSURE_DELETED = 'system.batch1.closure-deleted'

function clean(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').replace(/[\r\n\u0000]+/g, ' ').trim()
  return trimmed || fallback
}

function hasNumber(data: Record<string, string>): boolean {
  return data.hasNumber === 'true'
}

function reminder(data: Record<string, string>): SystemEmailContent {
  const business = clean(data.businessName, 'your business')
  const closedOn = clean(data.closedOn, '1 January 2026')
  const deletionOn = clean(data.deletionOn, '1 February 2026')
  const phone = clean(data.phoneNumber, '01632 960123')
  const numbered = hasNumber(data)
  return renderBrandedSystemEmail({
    subject: `Your StyleFlo data will be deleted on ${deletionOn}`,
    title: 'StyleFlo',
    subtitle: 'Account closure',
    paragraphs: [
      'Hello,',
      `The StyleFlo account for ${business} closed on ${closedOn}.`,
      numbered
        ? `We will delete the account data on ${deletionOn}. On the same day we will release the StyleFlo number ${phone}.`
        : `We will delete the account data on ${deletionOn}. This account has no StyleFlo number to release.`,
      numbered
        ? 'You can reopen the account before that date. Reopening keeps the data and the number.'
        : 'You can reopen the account before that date. Reopening keeps the data.',
      'We may keep billing records for as long as the law requires.',
    ],
  })
}

function deleted(data: Record<string, string>): SystemEmailContent {
  const business = clean(data.businessName, 'your business')
  const deletionOn = clean(data.deletionOn, '1 February 2026')
  const phone = clean(data.phoneNumber, '01632 960123')
  const numbered = hasNumber(data)
  return renderBrandedSystemEmail({
    subject: 'Your StyleFlo account data has been deleted',
    title: 'StyleFlo',
    subtitle: 'Account data deleted',
    paragraphs: [
      'Hello,',
      numbered
        ? `We have deleted the account data for ${business}. We have released the StyleFlo number ${phone}.`
        : `We have deleted the account data for ${business}. This account had no StyleFlo number to release.`,
      `This was done on ${deletionOn}.`,
      'We may keep billing records for as long as the law requires.',
    ],
  })
}

const sample = {
  businessName: 'Harbour Salon',
  closedOn: '1 January 2026',
  deletionOn: '1 February 2026',
  hasNumber: 'true',
  phoneNumber: '01632 960123',
}

/** STYL-276. One combined reminder and the deletion-day confirmation. */
export const batch1Templates: readonly SystemEmailTemplate[] = [
  {
    key: BATCH1_CLOSURE_REMINDER,
    sampleData: sample,
    render: reminder,
  },
  {
    key: BATCH1_CLOSURE_DELETED,
    sampleData: {
      businessName: 'Harbour Salon',
      closedOn: '1 January 2026',
      deletionOn: '1 February 2026',
      hasNumber: 'true',
      phoneNumber: '01632 960123',
    },
    render: deleted,
  },
]
