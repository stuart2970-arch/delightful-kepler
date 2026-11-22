import { sendSystemEmail, type SendSystemEmailResult } from '../../send-system-email'
import { isSystemEmailsBatch4Enabled } from './enabled'

export type Batch4SendResult =
  | SendSystemEmailResult
  | { ok: false; code: 'disabled' | 'invalid_input'; message: string }

type NoticeInput = {
  templateKey: string
  tenantId: string
  to: string
  eventId: string
  data: Record<string, string>
}

function idempotencyKey(templateKey: string, eventId: string): string {
  return `${templateKey}:${eventId}`.replace(/[\r\n\u0000]/g, '').slice(0, 200)
}

export async function sendBatch4Notice(input: NoticeInput): Promise<Batch4SendResult> {
  if (!isSystemEmailsBatch4Enabled()) {
    return { ok: false, code: 'disabled', message: 'Batch 4 system emails are turned off.' }
  }
  const eventId = input.eventId?.trim() || ''
  if (!eventId) {
    return { ok: false, code: 'invalid_input', message: 'An event id is required so the email is sent once.' }
  }
  return sendSystemEmail({
    templateKey: input.templateKey,
    tenantId: input.tenantId,
    to: input.to,
    data: input.data,
    idempotencyKey: idempotencyKey(input.templateKey, eventId),
  })
}

export function termsEndDateIsValid(endDate: string, now = new Date()): boolean {
  const end = new Date(endDate)
  if (Number.isNaN(end.getTime())) return false
  const earliest = new Date(now.getTime())
  earliest.setUTCMonth(earliest.getUTCMonth() + 1)
  return end.getTime() >= earliest.getTime()
}

export async function sendTermsEndNotice(input: {
  tenantId: string
  to: string
  eventId: string
  businessName: string
  endDate: string
  now?: Date
}): Promise<Batch4SendResult> {
  if (!termsEndDateIsValid(input.endDate, input.now)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Ending the Terms needs at least one month of notice. This email does not start a refund.',
    }
  }
  const endDate = new Date(input.endDate).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })
  return sendBatch4Notice({
    templateKey: 'enforcement.terms-end.notice',
    tenantId: input.tenantId,
    to: input.to,
    eventId: input.eventId,
    data: { businessName: input.businessName, endDate },
  })
}
