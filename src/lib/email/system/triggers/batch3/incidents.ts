import { createHash } from 'node:crypto'
import { createSystemEmailAdmin } from '../../admin'
import { isSystemEmailAddress, isSystemEmailTenantId, systemEmailStringData } from '../../data'
import { sendSystemEmail } from '../../send-system-email'
import { readAccountOwner } from './account-owner'
import { isSystemEmailsBatch3Enabled } from './enabled'

/** STYL-264 states 72 hours for notice #36. It is not applied to notice #53. */
export const SALON_BREACH_TICKET_TARGET_HOURS = 72

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BreachNoticeInput = {
  incidentId: string
  kind: 'salon' | 'individuals'
  tenantId: string | null
  awarenessAt: string
  nature: string
  peopleAffected: string
  recordsAffected: string
  consequences: string
  measures: string
  contactName: string
  recipients?: readonly string[]
  dryRun: boolean
  createdBy: string
}

export type BreachNoticeResult =
  | {
      ok: true
      dryRun: boolean
      incidentId: string
      ticketTargetAt: string | null
      solicitorTimingPending: true
      sent: number
      duplicates: number
      failed: number
    }
  | { ok: false; code: 'invalid_input' | 'disabled' | 'not_found' | 'store_failed'; message: string }

const emailKey = (incidentId: string, recipient: string): string => {
  const digest = createHash('sha256').update(recipient).digest('hex').slice(0, 32)
  return `b3inc:${incidentId}:${digest}`
}

/**
 * A failed provider attempt keeps its idempotency key in the shared log.
 * The next run uses a new key for that recipient. A sent row is never repeated.
 */
async function deliverBreachEmail(input: {
  incidentId: string
  templateKey: string
  tenantId: string | null
  to: string
  data: Record<string, string>
}): Promise<'sent' | 'duplicate' | 'failed'> {
  const admin = createSystemEmailAdmin()
  const base = emailKey(input.incidentId, input.to)
  const { data: rows } = await admin
    .from('system_email_log')
    .select('status, idempotency_key')
    .like('idempotency_key', `${base}%`)
  const related = (rows ?? []).filter((row) => {
    const key = String(row.idempotency_key || '')
    return key === base || key.startsWith(`${base}:r`)
  })
  if (related.some((row) => row.status === 'sent')) return 'duplicate'
  const failedCount = related.filter((row) => row.status === 'failed').length
  const idempotencyKey = failedCount === 0 ? base : `${base}:r${failedCount}`
  const result = await sendSystemEmail({
    templateKey: input.templateKey,
    tenantId: input.tenantId,
    to: input.to,
    data: input.data,
    idempotencyKey,
  })
  if (!result.ok) return 'failed'
  if (result.duplicate) return result.status === 'failed' ? 'failed' : 'duplicate'
  return 'sent'
}

export const ticketTargetForSalonBreach = (awarenessAt: Date): Date => {
  return new Date(awarenessAt.getTime() + SALON_BREACH_TICKET_TARGET_HOURS * 60 * 60 * 1000)
}

const requiredText = (value: string): boolean => value.trim().length > 0 && value.trim().length <= 2000

/**
 * Dry run returns the ticket target for a salon notice and sends nothing.
 * Confirm sends only while batch 3 is on. Notice #53 has no ticket target.
 */
export async function runBreachNotice(input: BreachNoticeInput): Promise<BreachNoticeResult> {
  if (!UUID_PATTERN.test(input.incidentId)) {
    return { ok: false, code: 'invalid_input', message: 'An incident id is required.' }
  }
  if (input.kind !== 'salon' && input.kind !== 'individuals') {
    return { ok: false, code: 'invalid_input', message: 'The incident kind is not valid.' }
  }
  const awareness = new Date(input.awarenessAt)
  if (Number.isNaN(awareness.getTime())) {
    return { ok: false, code: 'invalid_input', message: 'The date we became aware is required.' }
  }
  if (!requiredText(input.nature) || !requiredText(input.consequences) || !requiredText(input.measures) || !requiredText(input.contactName)) {
    return { ok: false, code: 'invalid_input', message: 'Nature, consequences, measures and a contact are required.' }
  }
  if (input.kind === 'salon' && !isSystemEmailTenantId(input.tenantId || '')) {
    return { ok: false, code: 'invalid_input', message: 'A salon account is required.' }
  }

  const ticketTargetAt = input.kind === 'salon' ? ticketTargetForSalonBreach(awareness).toISOString() : null
  const facts = systemEmailStringData({
    nature: input.nature.trim(),
    peopleAffected: input.peopleAffected.trim(),
    recordsAffected: input.recordsAffected.trim(),
    consequences: input.consequences.trim(),
    measures: input.measures.trim(),
    contactName: input.contactName.trim(),
    awarenessAt: input.awarenessAt.trim(),
  })

  const individualRecipients = [...new Set((input.recipients ?? []).map((email) => email.trim().toLowerCase()))]
  if (!input.dryRun && input.kind === 'individuals') {
    if (individualRecipients.length === 0 || individualRecipients.length > 50 || individualRecipients.some((email) => !isSystemEmailAddress(email))) {
      return { ok: false, code: 'invalid_input', message: 'List up to 50 individual email addresses.' }
    }
  }

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      incidentId: input.incidentId,
      ticketTargetAt,
      solicitorTimingPending: true,
      sent: 0,
      duplicates: 0,
      failed: 0,
    }
  }

  if (!isSystemEmailsBatch3Enabled()) {
    return { ok: false, code: 'disabled', message: 'Batch 3 system emails are switched off. Nothing was sent.' }
  }

  const admin = createSystemEmailAdmin()
  const { error: insertError } = await admin.from('personal_data_incidents').insert({
    id: input.incidentId,
    tenant_id: input.kind === 'salon' ? input.tenantId : null,
    kind: input.kind,
    awareness_at: awareness.toISOString(),
    ticket_target_at: ticketTargetAt,
    nature: facts.nature,
    people_affected: facts.peopleAffected || '',
    records_affected: facts.recordsAffected || '',
    consequences: facts.consequences,
    measures: facts.measures,
    contact_name: facts.contactName,
    created_by: input.createdBy,
  })

  if (insertError && insertError.code !== '23505') {
    return { ok: false, code: 'store_failed', message: 'The incident could not be recorded.' }
  }

  if (insertError?.code === '23505') {
    const { data: existing } = await admin
      .from('personal_data_incidents')
      .select('notified_at')
      .eq('id', input.incidentId)
      .maybeSingle()
    if (existing?.notified_at) {
      return {
        ok: true,
        dryRun: false,
        incidentId: input.incidentId,
        ticketTargetAt,
        solicitorTimingPending: true,
        sent: 0,
        duplicates: 1,
        failed: 0,
      }
    }
  }

  const deliveries: { to: string; tenantId: string | null; data: Record<string, string>; templateKey: string }[] = []
  if (input.kind === 'salon') {
    const owner = await readAccountOwner(input.tenantId || '')
    if (!owner) return { ok: false, code: 'not_found', message: 'That account has no owner email.' }
    deliveries.push({
      to: owner.email,
      tenantId: owner.tenantId,
      templateKey: 'system.batch3.breach-salon',
      data: { ...facts, businessName: owner.businessName },
    })
  } else {
    for (const email of individualRecipients) {
      deliveries.push({
        to: email,
        tenantId: null,
        templateKey: 'system.batch3.breach-individual',
        data: { ...facts, recipientName: 'there' },
      })
    }
  }

  let sent = 0
  let duplicates = 0
  let failed = 0
  for (const delivery of deliveries) {
    const outcome = await deliverBreachEmail({
      incidentId: input.incidentId,
      templateKey: delivery.templateKey,
      tenantId: delivery.tenantId,
      to: delivery.to,
      data: delivery.data,
    })
    if (outcome === 'failed') failed += 1
    else if (outcome === 'duplicate') duplicates += 1
    else sent += 1
  }

  if (failed === 0) {
    await admin
      .from('personal_data_incidents')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', input.incidentId)
  }

  return {
    ok: true,
    dryRun: false,
    incidentId: input.incidentId,
    ticketTargetAt,
    solicitorTimingPending: true,
    sent,
    duplicates,
    failed,
  }
}
