import { createHash } from 'node:crypto'
import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailAddress, isSystemEmailTenantId, systemEmailStringData } from '../../data'
import { sendSystemEmail } from '../../send-system-email'
import { readAccountOwner } from './account-owner'
import { isSystemEmailsBatch3Enabled } from './enabled'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DATA_RIGHTS_TEMPLATES = {
  'passed-on': 'system.batch3.dsar-passed-on',
  'legal-requirement': 'system.batch3.legal-requirement',
  'unlawful-instruction': 'system.batch3.unlawful-instruction',
  'deletion-confirmation': 'system.batch3.deletion-confirmation',
  'human-reply': 'system.batch3.data-rights-reply',
} as const

export type DataRightsKind = keyof typeof DATA_RIGHTS_TEMPLATES

const requiredByKind: Record<DataRightsKind, readonly string[]> = {
  'passed-on': ['requestSummary', 'receivedAt'],
  'legal-requirement': ['requirementSummary', 'effectiveDate'],
  'unlawful-instruction': ['instructionSummary', 'reason'],
  'deletion-confirmation': ['deletionSummary', 'completedAt'],
  'human-reply': ['requestSummary', 'repliedAt'],
}

export type DataRightsInput = {
  requestId: string
  kind: DataRightsKind
  tenantId: string
  data: Record<string, string>
  dryRun: boolean
}

export type DataRightsResult =
  | { ok: true; dryRun: boolean; sent: boolean; duplicate: boolean; loggedOnly: boolean }
  | { ok: false; code: 'invalid_input' | 'disabled' | 'not_found' | 'log_failed'; message: string }

const idempotencyKey = (requestId: string, kind: string): string => `b3right:${kind}:${requestId}`

/**
 * Sends one account notice, or records a human reply without calling Mailgun.
 */
export async function runDataRightsNotice(input: DataRightsInput): Promise<DataRightsResult> {
  const templateKey = DATA_RIGHTS_TEMPLATES[input.kind]
  if (!templateKey || !UUID_PATTERN.test(input.requestId) || !isSystemEmailTenantId(input.tenantId)) {
    return { ok: false, code: 'invalid_input', message: 'A request id, account and notice kind are required.' }
  }
  const data = systemEmailStringData(input.data)
  const missing = requiredByKind[input.kind].filter((field) => !data[field]?.trim())
  if (missing.length > 0) {
    return { ok: false, code: 'invalid_input', message: `These details are required: ${missing.join(', ')}.` }
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, sent: false, duplicate: false, loggedOnly: input.kind === 'human-reply' }
  }
  if (!isSystemEmailsBatch3Enabled()) {
    return { ok: false, code: 'disabled', message: 'Batch 3 system emails are switched off. Nothing was sent.' }
  }

  const owner = await readAccountOwner(input.tenantId)
  if (!owner) return { ok: false, code: 'not_found', message: 'That account has no owner email.' }
  const payload = { ...data, businessName: owner.businessName }
  const key = idempotencyKey(input.requestId, input.kind)

  if (input.kind === 'human-reply') {
    const admin = createSystemEmailAdmin()
    const { error } = await admin.from('system_email_log').insert({
      recipient: owner.email,
      template_key: templateKey,
      tenant_id: owner.tenantId,
      status: 'sent',
      provider_id: null,
      idempotency_key: key,
      template_data: { ...payload, recordedOnly: 'true' },
      error_message: 'Recorded only. The app did not send this reply.',
    })
    if (error?.code === '23505') {
      return { ok: true, dryRun: false, sent: false, duplicate: true, loggedOnly: true }
    }
    if (error) return { ok: false, code: 'log_failed', message: 'The reply could not be recorded.' }
    return { ok: true, dryRun: false, sent: false, duplicate: false, loggedOnly: true }
  }

  if (!isSystemEmailAddress(owner.email)) {
    return { ok: false, code: 'not_found', message: 'That account has no owner email.' }
  }
  const result = await sendSystemEmail({
    templateKey,
    tenantId: owner.tenantId,
    to: owner.email,
    data: payload,
    idempotencyKey: key,
  })
  if (!result.ok) {
    return { ok: false, code: 'log_failed', message: 'The notice could not be sent.' }
  }
  return { ok: true, dryRun: false, sent: !result.duplicate, duplicate: result.duplicate, loggedOnly: false }
}

export const dataRightsIdempotencyKey = (requestId: string, kind: DataRightsKind): string => {
  return idempotencyKey(requestId, kind)
}

export const hashGdprQuery = (query: string): string => {
  return createHash('sha256').update(query.trim().toLowerCase()).digest('hex').slice(0, 32)
}
