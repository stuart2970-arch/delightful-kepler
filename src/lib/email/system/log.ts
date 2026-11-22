import { createSystemEmailAdmin } from './admin'
import { isSystemEmailIdempotencyKey, isSystemEmailTenantId, systemEmailStringData } from './data'
import { listSystemEmailTemplates } from './registry'
import { sendSystemEmail, type SendSystemEmailResult } from './send-system-email'
import type { SystemEmailLogRow } from './types'

export type SystemEmailLogDto = {
  id: string
  createdAt: string
  recipient: string
  templateKey: string
  tenantId: string | null
  status: string
  providerId: string | null
  idempotencyKey: string
  errorMessage: string | null
  resendOfId: string | null
}

export function toSystemEmailLogDto(row: SystemEmailLogRow): SystemEmailLogDto {
  return {
    id: row.id,
    createdAt: row.created_at,
    recipient: row.recipient,
    templateKey: row.template_key,
    tenantId: row.tenant_id,
    status: row.status,
    providerId: row.provider_id,
    idempotencyKey: row.idempotency_key,
    errorMessage: row.error_message,
    resendOfId: row.resend_of_id,
  }
}

export async function listSystemEmailLog(options: { limit: number; tenantId?: string | null }): Promise<SystemEmailLogDto[]> {
  const admin = createSystemEmailAdmin()
  let query = admin
    .from('system_email_log')
    .select('id, created_at, updated_at, recipient, template_key, tenant_id, status, provider_id, idempotency_key, template_data, error_message, resend_of_id')
    .order('created_at', { ascending: false })
    .limit(options.limit)
  if (options.tenantId) {
    query = query.eq('tenant_id', options.tenantId)
  }
  const { data, error } = await query
  if (error) {
    throw new Error('Could not load the system email log')
  }
  return ((data || []) as SystemEmailLogRow[]).map(toSystemEmailLogDto)
}

export function listRegisteredTemplateSummaries() {
  return listSystemEmailTemplates().map((template) => ({
    key: template.key,
    sampleData: template.sampleData,
  }))
}

export async function resendSystemEmail(input: { logId: string; idempotencyKey?: string }): Promise<SendSystemEmailResult | { ok: false; code: 'not_found' | 'invalid_input' | 'log_failed'; message: string }> {
  if (!isSystemEmailTenantId(input.logId)) {
    return { ok: false, code: 'invalid_input', message: 'A log id is required.' }
  }
  const idempotencyKey = input.idempotencyKey?.trim() || ''
  if (idempotencyKey && !isSystemEmailIdempotencyKey(idempotencyKey)) {
    return { ok: false, code: 'invalid_input', message: 'The idempotency key is not valid.' }
  }

  const admin = createSystemEmailAdmin()
  const { data, error } = await admin
    .from('system_email_log')
    .select('id, recipient, template_key, tenant_id, template_data')
    .eq('id', input.logId)
    .maybeSingle()
  if (error) {
    return { ok: false, code: 'log_failed', message: 'Could not load that email.' }
  }
  if (!data) {
    return { ok: false, code: 'not_found', message: 'That email is not in the log.' }
  }

  const key = idempotencyKey || `resend:${data.id}:${crypto.randomUUID()}`
  return sendSystemEmail({
    templateKey: data.template_key,
    tenantId: data.tenant_id,
    to: data.recipient,
    data: systemEmailStringData(data.template_data),
    idempotencyKey: key,
    resendOfId: data.id,
  })
}
