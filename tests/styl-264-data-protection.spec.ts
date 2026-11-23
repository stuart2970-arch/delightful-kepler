import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { previewSystemEmail } from '../src/lib/email/system/registry'
import { batch3Templates } from '../src/lib/email/system/templates/batch-3'
import {
  readSystemEmailTestDeliveries,
  resetSystemEmailTestState,
  setSystemEmailTransportForTests,
  wasMailgunClientCreated,
} from '../src/lib/email/system/deliver'
import { runBreachNotice, ticketTargetForSalonBreach, SALON_BREACH_TICKET_TARGET_HOURS } from '../src/lib/email/system/triggers/batch3/incidents'
import { runDataRightsNotice } from '../src/lib/email/system/triggers/batch3/data-rights'
import { notifyMetaDataDeletion, notifySalonGdprRequest } from '../src/lib/email/system/triggers/batch3/meta-and-gdpr'
import { GET as retentionGet, PATCH as retentionPatch } from '../src/app/api/account/retention/route'
import { createTestUser, type TestUserSession } from './test-auth-helper'

/**
 * STYL-264 batch 3b: breach, data-rights, deletion emails and retention.
 * Local Supabase only. Mailgun stays on the Playwright mock.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

process.env.PLAYWRIGHT_TEST = 'true'

const breachFacts = {
  nature: 'a copy of booking names was sent to the wrong mailbox and then deleted',
  peopleAffected: 'customers with a booking in March 2027',
  recordsAffected: 'booking name and phone number',
  consequences: 'those details may have been seen by the wrong person',
  measures: 'the copy was deleted',
  contactName: 'StyleFlo support',
  awarenessAt: '2027-03-01T00:00:00.000Z',
}

const service = () => createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

test.describe('STYL-264 data protection templates', () => {
  test('breach and data-rights templates render facts and do not state a legal deadline', () => {
    const keys = batch3Templates.map((template) => template.key)
    expect(keys).toEqual([
      'system.batch3.sub-processor-change',
      'system.batch3.service-change',
      'system.batch3.urgent-change',
      'system.batch3.terms-change',
      'system.batch3.dpa-change',
      'system.batch3.privacy-change',
      'system.batch3.vat-registration',
      'system.batch3.contract-transfer',
      'system.batch3.breach-salon',
      'system.batch3.breach-individual',
      'system.batch3.meta-deletion-received',
      'system.batch3.meta-deletion-deleted',
      'system.batch3.dsar-passed-on',
      'system.batch3.legal-requirement',
      'system.batch3.unlawful-instruction',
      'system.batch3.deletion-confirmation',
      'system.batch3.data-rights-reply',
      'system.batch3.gdpr-confirmation',
      'system.batch3.gdpr-outcome',
    ])
    for (const template of batch3Templates) {
      const rendered = previewSystemEmail(template.key, { businessName: 'Harbour <Salon>', recipientName: 'Alex <b>' })
      expect(rendered?.subject.length).toBeGreaterThan(0)
      expect(rendered?.text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(rendered?.text).not.toMatch(/\b72 hours\b/)
      expect(rendered?.text.toLowerCase()).not.toContain('article 34')
      expect(rendered?.html).not.toContain('<Salon>')
    }
    expect(previewSystemEmail('system.batch3.breach-salon')?.text).toContain('clause 6A.7')
    expect(previewSystemEmail('system.batch3.breach-individual')?.text).toContain('Part F')
    expect(previewSystemEmail('system.batch3.dsar-passed-on')?.text).toContain('clause 8.2')
    expect(previewSystemEmail('system.batch3.legal-requirement')?.text).toContain('clause 3.1')
    expect(previewSystemEmail('system.batch3.unlawful-instruction')?.text).toContain('clause 3.4')
    expect(previewSystemEmail('system.batch3.deletion-confirmation')?.text).toContain('clause 10.3')
    expect(previewSystemEmail('system.batch3.data-rights-reply')?.text).toContain('does not send the reply')
    expect(previewSystemEmail('system.batch3.gdpr-confirmation')?.text).toContain('not the outcome')
    expect(SALON_BREACH_TICKET_TARGET_HOURS).toBe(72)
    const target = ticketTargetForSalonBreach(new Date('2027-03-01T00:00:00.000Z'))
    expect(target.toISOString()).toBe('2027-03-04T00:00:00.000Z')
  })

  test('the account tab includes the retention card', () => {
    const source = readFileSync('src/components/DashboardClient.tsx', 'utf8')
    expect(source).toContain("import RetentionPeriodCard from './dashboard-views/RetentionPeriodCard'")
    expect(source).toContain('<RetentionPeriodCard />')
  })
})

test.describe('STYL-264 breach, data rights and retention', () => {
  let tenantId = ''
  let owner: TestUserSession
  let member: TestUserSession
  const previousApp = process.env.APP_ENV

  test.beforeAll(async () => {
    const admin = service()
    const { data: tenant, error } = await admin
      .from('tenants')
      .insert({ company_name: 'Retention Test Salon' })
      .select('id')
      .single()
    if (error || !tenant) throw new Error(error?.message || 'tenant')
    tenantId = tenant.id
    owner = await createTestUser({ tenantId, role: 'owner' })
    member = await createTestUser({ tenantId, role: 'member' })
  })

  test.afterAll(async () => {
    if (previousApp === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = previousApp
    const admin = service()
    if (tenantId) {
      await admin.from('personal_data_incidents').delete().eq('tenant_id', tenantId)
      await admin.from('system_email_log').delete().eq('tenant_id', tenantId)
    }
    if (owner) await owner.cleanup()
    if (member) await member.cleanup()
    if (tenantId) await service().from('tenants').delete().eq('id', tenantId)
  })

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    delete process.env.SYSTEM_EMAILS_BATCH3_ENABLED
    if (previousApp === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = previousApp
    resetSystemEmailTestState()
  })

  test('a salon breach dry run sets the ticket target and sends nothing', async () => {
    const result = await runBreachNotice({
      incidentId: crypto.randomUUID(),
      kind: 'salon',
      tenantId,
      ...breachFacts,
      dryRun: true,
      createdBy: owner.user.id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sent).toBe(0)
    expect(result.ticketTargetAt).toBe('2027-03-04T00:00:00.000Z')
    expect(result.solicitorTimingPending).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)

    const individual = await runBreachNotice({
      incidentId: crypto.randomUUID(),
      kind: 'individuals',
      tenantId: null,
      ...breachFacts,
      recipients: [owner.user.email],
      dryRun: true,
      createdBy: owner.user.id,
    })
    expect(individual.ok).toBe(true)
    if (individual.ok) expect(individual.ticketTargetAt).toBeNull()
  })

  test('confirm is refused while the flag is off, then the same incident sends once', async () => {
    const incidentId = crypto.randomUUID()
    const input = {
      incidentId,
      kind: 'salon' as const,
      tenantId,
      ...breachFacts,
      dryRun: false,
      createdBy: owner.user.id,
    }
    const blocked = await runBreachNotice(input)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('disabled')
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)

    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    process.env.APP_ENV = 'production'
    const first = await runBreachNotice(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.sent).toBe(1)
    expect(wasMailgunClientCreated()).toBe(false)
    expect(readSystemEmailTestDeliveries()[0].text).toContain('clause 6A.7')
    expect(readSystemEmailTestDeliveries()[0].text).not.toMatch(/\b72 hours\b/)

    const second = await runBreachNotice(input)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.duplicates).toBe(1)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
  })

  test('a human reply is logged once and is not sent', async () => {
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    const requestId = crypto.randomUUID()
    const input = {
      requestId,
      kind: 'human-reply' as const,
      tenantId,
      data: { requestSummary: 'a copy of account data', repliedAt: '5 March 2027' },
      dryRun: false,
    }
    const first = await runDataRightsNotice(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.loggedOnly).toBe(true)
    expect(first.sent).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    expect(wasMailgunClientCreated()).toBe(false)

    const { data } = await service()
      .from('system_email_log')
      .select('status, provider_id, template_key')
      .eq('idempotency_key', `b3right:human-reply:${requestId}`)
    expect(data).toHaveLength(1)
    expect(data?.[0].provider_id).toBeNull()
    expect(data?.[0].template_key).toBe('system.batch3.data-rights-reply')

    const second = await runDataRightsNotice(input)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.duplicate).toBe(true)
  })

  test('Meta deletion emails send only when an address is known, once per phase', async () => {
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    process.env.APP_ENV = 'production'
    const code = `del_${crypto.randomUUID().replace(/-/g, '')}`
    const statusUrl = `http://localhost:3001/api/data-deletion?code=${code}`
    const missing = await notifyMetaDataDeletion({ confirmationCode: code, statusUrl, email: null, phase: 'received' })
    expect(missing.sent).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)

    const received = await notifyMetaDataDeletion({
      confirmationCode: code,
      statusUrl,
      email: owner.user.email,
      phase: 'received',
    })
    expect(received.sent).toBe(true)
    const again = await notifyMetaDataDeletion({
      confirmationCode: code,
      statusUrl,
      email: owner.user.email,
      phase: 'received',
    })
    expect(again.sent).toBe(false)
    const deleted = await notifyMetaDataDeletion({
      confirmationCode: code,
      statusUrl,
      email: owner.user.email,
      phase: 'deleted',
    })
    expect(deleted.sent).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(2)
    expect(wasMailgunClientCreated()).toBe(false)
  })

  test('the salon GDPR confirmation is sent once per event, including a later request with the same text', async () => {
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    process.env.APP_ENV = 'production'
    const input = {
      tenantId,
      businessName: 'Retention Test Salon',
      to: owner.user.email,
      phase: 'confirmation' as const,
      requestSummary: 'customer example',
      eventId: crypto.randomUUID(),
    }
    const first = await notifySalonGdprRequest(input)
    const second = await notifySalonGdprRequest(input)
    expect(first.sent).toBe(true)
    expect(second.sent).toBe(false)
    const later = await notifySalonGdprRequest({ ...input, eventId: crypto.randomUUID() })
    expect(later.sent).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(2)
    expect(readSystemEmailTestDeliveries()[0].text).toContain('not the outcome')
  })

  test('a failed breach send is retried and the incident stays open until every send succeeds', async () => {
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    process.env.APP_ENV = 'production'
    const incidentId = crypto.randomUUID()
    const input = {
      incidentId,
      kind: 'salon' as const,
      tenantId,
      ...breachFacts,
      dryRun: false,
      createdBy: owner.user.id,
    }
    setSystemEmailTransportForTests(async () => {
      throw new Error('provider down')
    })
    const first = await runBreachNotice(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.failed).toBe(1)
    expect(first.sent).toBe(0)
    const { data: open } = await service()
      .from('personal_data_incidents')
      .select('notified_at')
      .eq('id', incidentId)
      .single()
    expect(open?.notified_at).toBeNull()

    resetSystemEmailTestState()
    process.env.PLAYWRIGHT_TEST = 'true'
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    process.env.APP_ENV = 'production'
    const second = await runBreachNotice(input)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.sent).toBe(1)
    expect(second.failed).toBe(0)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    const { data: closed } = await service()
      .from('personal_data_incidents')
      .select('notified_at')
      .eq('id', incidentId)
      .single()
    expect(closed?.notified_at).toBeTruthy()

    const third = await runBreachNotice(input)
    expect(third.ok).toBe(true)
    if (third.ok) expect(third.duplicates).toBe(1)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
  })

  test('retention starts at 12 months and 90 days and can only be shortened', async () => {
    const headers = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }
    const loaded = await retentionGet(new NextRequest('http://localhost:3001/api/account/retention', { headers }))
    expect(loaded.status).toBe(200)
    const initial = await loaded.json()
    expect(initial.accountRecordRetentionDays).toBe(365)
    expect(initial.messageRetentionDays).toBe(90)

    const shortened = await retentionPatch(new NextRequest('http://localhost:3001/api/account/retention', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountRecordRetentionDays: 200, messageRetentionDays: 40 }),
    }))
    expect(shortened.status).toBe(200)
    const saved = await shortened.json()
    expect(saved.accountRecordRetentionDays).toBe(200)
    expect(saved.messageRetentionDays).toBe(40)

    const lengthened = await retentionPatch(new NextRequest('http://localhost:3001/api/account/retention', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountRecordRetentionDays: 300, messageRetentionDays: 40 }),
    }))
    expect(lengthened.status).toBe(409)

    const overCeiling = await retentionPatch(new NextRequest('http://localhost:3001/api/account/retention', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ accountRecordRetentionDays: 400, messageRetentionDays: 40 }),
    }))
    expect(overCeiling.status).toBe(400)

    const memberAttempt = await retentionPatch(new NextRequest('http://localhost:3001/api/account/retention', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountRecordRetentionDays: 10, messageRetentionDays: 10 }),
    }))
    expect(memberAttempt.status).toBe(403)

    const still = await retentionGet(new NextRequest('http://localhost:3001/api/account/retention', { headers }))
    const body = await still.json()
    expect(body.accountRecordRetentionDays).toBe(200)
    expect(body.messageRetentionDays).toBe(40)
  })
})
