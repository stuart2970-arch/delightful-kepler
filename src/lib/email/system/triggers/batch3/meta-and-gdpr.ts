import { isSystemEmailAddress, isSystemEmailTenantId } from '../../data'
import { sendSystemEmail } from '../../send-system-email'
import { isSystemEmailsBatch3Enabled } from './enabled'

const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MetaDeletionPhase = 'received' | 'deleted'

/**
 * Meta's callback has no email address. When none is known, nothing is sent.
 * The status URL in the callback response is unchanged.
 */
export async function notifyMetaDataDeletion(input: {
  confirmationCode: string
  statusUrl: string
  email: string | null
  phase: MetaDeletionPhase
}): Promise<{ sent: boolean }> {
  try {
    if (!isSystemEmailsBatch3Enabled()) return { sent: false }
    const email = input.email?.trim().toLowerCase() || ''
    if (!isSystemEmailAddress(email)) return { sent: false }
    const code = input.confirmationCode.trim()
    if (!code || code.length > 80) return { sent: false }
    const result = await sendSystemEmail({
      templateKey: input.phase === 'received'
        ? 'system.batch3.meta-deletion-received'
        : 'system.batch3.meta-deletion-deleted',
      tenantId: null,
      to: email,
      data: { confirmationCode: code, statusUrl: input.statusUrl },
      idempotencyKey: `b3meta:${code}:${input.phase}`,
    })
    return { sent: result.ok && !result.duplicate }
  } catch {
    return { sent: false }
  }
}

export async function notifySalonGdprRequest(input: {
  tenantId: string
  businessName: string
  to: string
  phase: 'confirmation' | 'outcome'
  requestSummary: string
  outcomeSummary?: string
  eventId: string
}): Promise<{ sent: boolean }> {
  try {
    if (!isSystemEmailsBatch3Enabled()) return { sent: false }
    const to = input.to.trim().toLowerCase()
    const eventId = input.eventId?.trim() || ''
    if (!isSystemEmailAddress(to) || !isSystemEmailTenantId(input.tenantId) || !EVENT_ID_PATTERN.test(eventId)) {
      return { sent: false }
    }
    const summary = input.requestSummary.trim().slice(0, 500)
    if (!summary) return { sent: false }
    const result = await sendSystemEmail({
      templateKey: input.phase === 'confirmation'
        ? 'system.batch3.gdpr-confirmation'
        : 'system.batch3.gdpr-outcome',
      tenantId: input.tenantId,
      to,
      data: {
        businessName: input.businessName.trim() || 'Your business',
        requestSummary: summary,
        outcomeSummary: (input.outcomeSummary || '').trim().slice(0, 500),
      },
      idempotencyKey: `b3gdpr:${input.phase}:${input.tenantId}:${eventId}`,
    })
    return { sent: result.ok && !result.duplicate }
  } catch {
    return { sent: false }
  }
}
