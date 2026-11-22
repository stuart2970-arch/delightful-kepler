import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailAddress, isSystemEmailTenantId, systemEmailStringData } from '../../data'
import { sendSystemEmail, type SendSystemEmailResult } from '../../send-system-email'
import { batch3MassNoticeDefinition, isBatch3MassTemplateKey } from '../../templates/batch-3'
import { isSystemEmailsBatch3Enabled } from './enabled'

const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const NOTICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AffectedAccountRecipient = {
  tenantId: string
  businessName: string
  userId: string
  email: string
}

export type MassNoticeRecipientResult = {
  tenantId: string
  businessName: string
  email: string
  outcome: 'sent' | 'duplicate' | 'failed' | 'skipped'
  logId?: string
}

export type MassNoticeResult =
  | {
      ok: true
      dryRun: boolean
      enabled: boolean
      noticeId: string
      templateKey: string
      recipients: AffectedAccountRecipient[]
      results: MassNoticeRecipientResult[]
      sent: number
      duplicates: number
      failed: number
    }
  | {
      ok: false
      code: 'invalid_input' | 'disabled' | 'list_failed'
      message: string
    }

export type MassNoticeInput = {
  noticeId: string
  templateKey: string
  data?: Record<string, string>
  dryRun: boolean
  recipients?: readonly AffectedAccountRecipient[]
}

const missingRequiredFields = (templateKey: string, data: Record<string, string>): string[] => {
  const definition = batch3MassNoticeDefinition(templateKey)
  if (!definition) return ['templateKey']
  return definition.fields
    .filter((field) => field.required)
    .filter((field) => !data[field.name]?.trim())
    .map((field) => field.name)
}

export const massNoticeIdempotencyKey = (noticeId: string, tenantId: string): string => {
  return `b3n:${noticeId}:${tenantId}`
}

/**
 * Active accounts with an owner login email. The platform tenant is excluded.
 * One owner per account: the earliest owner profile.
 */
export async function listAffectedAccountRecipients(): Promise<AffectedAccountRecipient[]> {
  const admin = createSystemEmailAdmin()
  const { data: tenants, error: tenantError } = await admin
    .from('tenants')
    .select('id, company_name, is_active')
  if (tenantError) {
    throw new Error('Could not list accounts')
  }

  const active = (tenants ?? []).filter((tenant) => {
    if (!tenant?.id || tenant.id === GLOBAL_TENANT_ID) return false
    return tenant.is_active !== false
  })
  const tenantIds = active.map((tenant) => tenant.id as string)
  if (tenantIds.length === 0) return []

  const names = new Map(active.map((tenant) => [tenant.id as string, String(tenant.company_name || 'Your business')]))
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, tenant_id, created_at')
    .eq('role', 'owner')
    .in('tenant_id', tenantIds)
  if (profileError) {
    throw new Error('Could not list account owners')
  }

  const ownerByTenant = new Map<string, { id: string; createdAt: string }>()
  for (const profile of profiles ?? []) {
    const tenantId = String(profile.tenant_id || '')
    const userId = String(profile.id || '')
    if (!isSystemEmailTenantId(tenantId) || !isSystemEmailTenantId(userId)) continue
    const createdAt = String(profile.created_at || '')
    const current = ownerByTenant.get(tenantId)
    if (!current || createdAt < current.createdAt) {
      ownerByTenant.set(tenantId, { id: userId, createdAt })
    }
  }

  const emailByUser = new Map<string, string>()
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error('Could not list account emails')
    const users = data?.users ?? []
    for (const user of users) {
      const email = user.email?.trim().toLowerCase() || ''
      if (user.id && isSystemEmailAddress(email)) emailByUser.set(user.id, email)
    }
    if (users.length < 200) break
    page += 1
    if (page > 50) break
  }

  const recipients: AffectedAccountRecipient[] = []
  for (const [tenantId, owner] of ownerByTenant) {
    const email = emailByUser.get(owner.id)
    if (!email) continue
    recipients.push({
      tenantId,
      businessName: names.get(tenantId) || 'Your business',
      userId: owner.id,
      email,
    })
  }
  recipients.sort((left, right) => left.businessName.localeCompare(right.businessName, 'en-GB'))
  return recipients
}

const countOutcomes = (results: MassNoticeRecipientResult[]) => {
  return {
    sent: results.filter((row) => row.outcome === 'sent').length,
    duplicates: results.filter((row) => row.outcome === 'duplicate').length,
    failed: results.filter((row) => row.outcome === 'failed' || row.outcome === 'skipped').length,
  }
}

const outcomeFor = (result: SendSystemEmailResult): MassNoticeRecipientResult['outcome'] => {
  if (!result.ok) return result.code === 'recipient_not_allowed' ? 'skipped' : 'failed'
  return result.duplicate ? 'duplicate' : 'sent'
}

/**
 * Dry run lists recipients and sends nothing.
 * Confirm sends only when SYSTEM_EMAILS_BATCH3_ENABLED=true.
 * The idempotency key is the notice id plus the account, so a re-run does not send again.
 */
export async function runMassNotice(input: MassNoticeInput): Promise<MassNoticeResult> {
  const noticeId = input.noticeId?.trim() || ''
  const templateKey = input.templateKey?.trim() || ''
  if (!NOTICE_ID_PATTERN.test(noticeId) || !isBatch3MassTemplateKey(templateKey)) {
    return { ok: false, code: 'invalid_input', message: 'A notice id and a batch 3 notice template are required.' }
  }

  const data = systemEmailStringData(input.data)
  const missing = missingRequiredFields(templateKey, data)
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `These details are required: ${missing.join(', ')}.`,
    }
  }

  if (!input.dryRun && !isSystemEmailsBatch3Enabled()) {
    return {
      ok: false,
      code: 'disabled',
      message: 'Batch 3 system emails are switched off. Nothing was sent.',
    }
  }

  let recipients: AffectedAccountRecipient[]
  try {
    recipients = input.recipients ? [...input.recipients] : await listAffectedAccountRecipients()
  } catch {
    return { ok: false, code: 'list_failed', message: 'Affected accounts could not be listed.' }
  }

  const safeRecipients = recipients.filter((recipient) => {
    return isSystemEmailTenantId(recipient.tenantId)
      && isSystemEmailTenantId(recipient.userId)
      && isSystemEmailAddress(recipient.email)
      && recipient.businessName.trim().length > 0
  })

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      enabled: isSystemEmailsBatch3Enabled(),
      noticeId,
      templateKey,
      recipients: safeRecipients,
      results: [],
      sent: 0,
      duplicates: 0,
      failed: 0,
    }
  }

  const results: MassNoticeRecipientResult[] = []
  for (const recipient of safeRecipients) {
    const sent = await sendSystemEmail({
      templateKey,
      tenantId: recipient.tenantId,
      to: recipient.email,
      data: { ...data, businessName: recipient.businessName },
      idempotencyKey: massNoticeIdempotencyKey(noticeId, recipient.tenantId),
    })
    results.push({
      tenantId: recipient.tenantId,
      businessName: recipient.businessName,
      email: recipient.email,
      outcome: outcomeFor(sent),
      logId: sent.logId,
    })
  }

  return {
    ok: true,
    dryRun: false,
    enabled: true,
    noticeId,
    templateKey,
    recipients: safeRecipients,
    results,
    ...countOutcomes(results),
  }
}
