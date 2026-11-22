import { createSystemEmailAdmin } from './admin'
import { systemEmailStringData, isSystemEmailAddress, isSystemEmailIdempotencyKey, isSystemEmailTenantId } from './data'
import { deliverSystemEmail, systemEmailReplyTo } from './deliver'
import { assertSystemEmailRecipientAllowed } from './guard'
import { getSystemEmailTemplate, renderSystemEmail } from './registry'
import type { SystemEmailStatus } from './types'

export type SendSystemEmailInput = {
  templateKey: string
  tenantId: string | null
  to: string
  data?: Record<string, string>
  idempotencyKey: string
  resendOfId?: string | null
}

export type SendSystemEmailResult =
  | {
      ok: true
      duplicate: boolean
      logId: string
      status: SystemEmailStatus
      providerId: string | null
    }
  | {
      ok: false
      code:
        | 'invalid_input'
        | 'unknown_template'
        | 'recipient_not_allowed'
        | 'tenant_not_found'
        | 'send_failed'
        | 'log_failed'
      message: string
      logId?: string
    }

type ClaimedRow = {
  id: string
  status: SystemEmailStatus
  provider_id: string | null
}

function failure(
  code: 'invalid_input' | 'unknown_template' | 'recipient_not_allowed' | 'tenant_not_found' | 'send_failed' | 'log_failed',
  message: string,
  logId?: string,
): SendSystemEmailResult {
  return logId ? { ok: false, code, message, logId } : { ok: false, code, message }
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '23505') return true
  return /duplicate key|unique constraint/i.test(error.message || '')
}

function isForeignKeyViolation(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error) return false
  if (error.code === '23503') return true
  return /foreign key/i.test(error.message || '')
}

async function readExisting(idempotencyKey: string): Promise<ClaimedRow | null> {
  const admin = createSystemEmailAdmin()
  const { data, error } = await admin
    .from('system_email_log')
    .select('id, status, provider_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (error || !data) return null
  return data as ClaimedRow
}

/**
 * Send one StyleFlo system email through Mailgun EU.
 * The idempotency key is unique in system_email_log, so a second call
 * with the same key does not send again.
 */
export async function sendSystemEmail(input: SendSystemEmailInput): Promise<SendSystemEmailResult> {
  const templateKey = input.templateKey?.trim() || ''
  const idempotencyKey = input.idempotencyKey?.trim() || ''
  const to = input.to?.trim().toLowerCase() || ''
  const tenantId = input.tenantId

  if (!templateKey || !isSystemEmailAddress(to) || !isSystemEmailIdempotencyKey(idempotencyKey)) {
    return failure('invalid_input', 'A template, a valid recipient, and an idempotency key are required.')
  }
  if (tenantId !== null && !isSystemEmailTenantId(tenantId)) {
    return failure('invalid_input', 'tenantId must be a tenant id.')
  }
  if (input.resendOfId && !isSystemEmailTenantId(input.resendOfId)) {
    return failure('invalid_input', 'resendOfId must be a log id.')
  }

  const template = getSystemEmailTemplate(templateKey)
  if (!template) {
    return failure('unknown_template', 'That system email template is not registered.')
  }

  const guard = assertSystemEmailRecipientAllowed(to)
  if (!guard.ok) {
    return failure('recipient_not_allowed', 'This address cannot receive system email outside production.')
  }

  const data = systemEmailStringData(input.data)
  const content = renderSystemEmail(template, data)
  if (!content.subject.trim() || !content.text.trim() || !content.html.trim()) {
    return failure('invalid_input', 'The template did not render a subject, plain text, and HTML.')
  }

  const admin = createSystemEmailAdmin()
  const { data: inserted, error: insertError } = await admin
    .from('system_email_log')
    .insert({
      recipient: to,
      template_key: template.key,
      tenant_id: tenantId,
      status: 'queued',
      idempotency_key: idempotencyKey,
      template_data: data,
      resend_of_id: input.resendOfId ?? null,
    })
    .select('id, status, provider_id')
    .maybeSingle()

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const existing = await readExisting(idempotencyKey)
      if (!existing) {
        return failure('log_failed', 'This event was already recorded, but the log row could not be read.')
      }
      return {
        ok: true,
        duplicate: true,
        logId: existing.id,
        status: existing.status,
        providerId: existing.provider_id,
      }
    }
    if (isForeignKeyViolation(insertError)) {
      const detail = `${insertError.message || ''} ${insertError.details || ''}`
      if (/tenant_id/i.test(detail)) {
        return failure('tenant_not_found', 'That tenant does not exist.')
      }
      return failure('invalid_input', 'That email log row does not exist.')
    }
    return failure('log_failed', 'The system email could not be recorded.')
  }

  if (!inserted?.id) {
    const existing = await readExisting(idempotencyKey)
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        logId: existing.id,
        status: existing.status,
        providerId: existing.provider_id,
      }
    }
    return failure('log_failed', 'The system email could not be recorded.')
  }

  const logId = inserted.id as string
  try {
    const delivered = await deliverSystemEmail({
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: systemEmailReplyTo(),
    })
    const { error: updateError } = await admin
      .from('system_email_log')
      .update({
        status: 'sent',
        provider_id: delivered.id,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId)
    if (updateError) {
      return {
        ok: true,
        duplicate: false,
        logId,
        status: 'sent',
        providerId: delivered.id,
      }
    }
    return {
      ok: true,
      duplicate: false,
      logId,
      status: 'sent',
      providerId: delivered.id,
    }
  } catch {
    console.error('[system-email] provider send failed', { templateKey: template.key, logId })
    await admin
      .from('system_email_log')
      .update({
        status: 'failed',
        error_message: 'The email provider did not accept the message.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId)
    return failure('send_failed', 'The email provider did not accept the message.', logId)
  }
}
