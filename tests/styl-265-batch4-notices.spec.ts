import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { previewSystemEmail } from '../src/lib/email/system/registry'
import { batch4Templates } from '../src/lib/email/system/templates/batch-4'
import { readSystemEmailTestDeliveries, resetSystemEmailTestState, wasMailgunClientCreated } from '../src/lib/email/system/deliver'
import { sendBatch4Notice, sendTermsEndNotice, termsEndDateIsValid } from '../src/lib/email/system/triggers/batch4/notices'
import { isSystemEmailsBatch4Enabled, complaintForwardRecipient } from '../src/lib/email/system/triggers/batch4/enabled'
import { dispatchBatch4ChatEmail, messageAsksForAPerson, messageIsLabelledComplaint } from '../src/lib/email/system/triggers/batch4/chat'
import { POST } from '../src/app/api/superadmin/system-emails/batch4/route'
import { createTestSuperadminUser, type TestUserSession } from './test-auth-helper'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const root = path.resolve(__dirname, '..')
const TO = 'test999@styleflo.ai'

process.env.PLAYWRIGHT_TEST = 'true'

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-265 batch 4 notices', () => {
  let tenantId = ''
  let superadmin: TestUserSession

  test.beforeAll(async () => {
    expect(serviceRoleKey).not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    expect(supabaseUrl).not.toContain('lriugykhrfnnouexqqhm')
    const admin = adminClient()
    const suffix = `${Date.now()}`
    const { data, error } = await admin
      .from('tenants')
      .insert({ company_name: `Batch4 ${suffix}`, slug: `batch4-${suffix}` })
      .select('id')
      .single()
    expect(error).toBeNull()
    tenantId = data!.id
    superadmin = await createTestSuperadminUser()
  })

  test.afterAll(async () => {
    const admin = adminClient()
    if (tenantId) {
      await admin.from('system_email_log').delete().eq('tenant_id', tenantId)
      await admin.from('tenants').delete().eq('id', tenantId)
    }
    if (superadmin) await superadmin.cleanup()
  })

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    delete process.env.SYSTEM_EMAILS_BATCH4_ENABLED
    resetSystemEmailTestState()
  })

  test('templates state only the Terms facts and render subject, HTML and text', () => {
    const keys = batch4Templates.map((template) => template.key)
    expect(keys).toEqual([
      'enforcement.breach.notice',
      'enforcement.suspension.notice',
      'enforcement.termination.notice',
      'enforcement.terms-end.notice',
      'complaint.forward',
      'complaint.acknowledgement',
      'fair-use.warning',
      'channel.launch.notice',
      'maintenance.planned.notice',
      'support.human-follow-up',
    ])
    for (const template of batch4Templates) {
      const rendered = previewSystemEmail(template.key, {}, { PLAYWRIGHT_TEST: 'true' } as NodeJS.ProcessEnv)
      expect(rendered?.subject.length).toBeGreaterThan(0)
      expect(rendered?.html).toContain('StyleFlo')
      expect(rendered?.text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(rendered?.html).not.toContain('<script>')
    }
    const breach = previewSystemEmail('enforcement.breach.notice', { whatIsWrong: '<b>no</b>' })
    expect(breach?.text).toContain('14 days')
    expect(breach?.html).toContain('&lt;b&gt;no&lt;/b&gt;')
    const ended = previewSystemEmail('enforcement.terms-end.notice')
    expect(ended?.text).toContain('at least one month')
    expect(ended?.text).toContain('does not start a refund')
    expect(previewSystemEmail('complaint.acknowledgement')?.text).toContain('2 working days')
    expect(previewSystemEmail('complaint.acknowledgement')?.text).toContain('10 working days')
    expect(previewSystemEmail('fair-use.warning')?.text).toContain('contacting you first')
    expect(previewSystemEmail('channel.launch.notice')?.text).toContain('before that channel launches')
    expect(previewSystemEmail('maintenance.planned.notice')?.text).toContain('before that maintenance')
    const doc = readFileSync(path.join(root, 'docs/system-emails/batch-4-previews.md'), 'utf8')
    for (const template of batch4Templates) {
      const rendered = previewSystemEmail(template.key, {}, { PLAYWRIGHT_TEST: 'true' } as NodeJS.ProcessEnv)
      expect(doc).toContain(rendered?.subject || 'missing-subject')
      expect(doc).toContain(rendered?.text || 'missing-text')
    }
  })

  test('the flag defaults off and a second event does not send again', async () => {
    expect(isSystemEmailsBatch4Enabled()).toBe(false)
    const blocked = await sendBatch4Notice({
      templateKey: 'enforcement.breach.notice',
      tenantId,
      to: TO,
      eventId: 'breach-once',
      data: { businessName: 'Harbour Salon', whatIsWrong: 'Unlawful messages.' },
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('disabled')
    const { count } = await adminClient().from('system_email_log').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    expect(count).toBe(0)

    process.env.SYSTEM_EMAILS_BATCH4_ENABLED = 'true'
    const first = await sendBatch4Notice({
      templateKey: 'enforcement.breach.notice',
      tenantId,
      to: TO,
      eventId: 'breach-once',
      data: { businessName: 'Harbour Salon', whatIsWrong: 'Unlawful messages.' },
    })
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.duplicate).toBe(false)
    const second = await sendBatch4Notice({
      templateKey: 'enforcement.breach.notice',
      tenantId,
      to: TO,
      eventId: 'breach-once',
      data: { businessName: 'Harbour Salon', whatIsWrong: 'Unlawful messages.' },
    })
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.duplicate).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    expect(wasMailgunClientCreated()).toBe(false)
  })

  test('ending the Terms refuses a short notice and does not refund by itself', async () => {
    const source = readFileSync(path.join(root, 'src/lib/email/system/triggers/batch4/notices.ts'), 'utf8')
    expect(source).not.toContain('stripe')
    expect(source).not.toContain('refunds.create')
    const now = new Date('2026-11-01T00:00:00.000Z')
    expect(termsEndDateIsValid('2026-11-20', now)).toBe(false)
    expect(termsEndDateIsValid('2026-12-01T00:00:00.000Z', now)).toBe(true)
    process.env.SYSTEM_EMAILS_BATCH4_ENABLED = 'true'
    const refused = await sendTermsEndNotice({
      tenantId,
      to: TO,
      eventId: 'end-too-soon',
      businessName: 'Harbour Salon',
      endDate: '2026-11-20',
      now,
    })
    expect(refused.ok).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    const sent = await sendTermsEndNotice({
      tenantId,
      to: TO,
      eventId: 'end-ok',
      businessName: 'Harbour Salon',
      endDate: '2026-12-15',
      now,
    })
    expect(sent.ok).toBe(true)
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain('does not start a refund')
    expect(complaintForwardRecipient({ APP_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('support@styleflo.ai')
    expect(complaintForwardRecipient({ APP_ENV: 'staging' } as NodeJS.ProcessEnv)).toBe(TO)
  })

  test('a labelled complaint and a request for a person send once', async () => {
    expect(messageAsksForAPerson('Can I speak to a person?')).toBe(true)
    expect(messageIsLabelledComplaint('This is a complaint about the booking.')).toBe(true)
    expect(messageAsksForAPerson('What time are you open?')).toBe(false)
    process.env.SYSTEM_EMAILS_BATCH4_ENABLED = 'true'
    const conversationId = crypto.randomUUID()
    await dispatchBatch4ChatEmail({
      tenantId,
      conversationId,
      messageText: 'This is a complaint and I need to speak to a person.',
      businessName: 'Harbour Salon',
      to: TO,
    })
    await dispatchBatch4ChatEmail({
      tenantId,
      conversationId,
      messageText: 'This is a complaint and I need to speak to a person.',
      businessName: 'Harbour Salon',
      to: TO,
    })
    const deliveries = readSystemEmailTestDeliveries()
    expect(deliveries).toHaveLength(3)
    expect(deliveries.map((item) => item.subject).sort()).toEqual([
      'A person from StyleFlo will follow up',
      'Complaint forwarded for Harbour Salon',
      'We have received your complaint',
    ].sort())
    expect(deliveries.every((item) => item.replyTo === 'support@styleflo.ai')).toBe(true)
  })

  test('superadmin send is refused while the flag is off', async () => {
    const response = await POST(new NextRequest('http://localhost:3001/api/superadmin/system-emails/batch4', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${superadmin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'fair-use',
        tenantId,
        to: TO,
        eventId: 'fair-1',
        businessName: 'Harbour Salon',
        data: { summary: 'Volume is clearly outside normal use.' },
      }),
    }))
    expect(response.status).toBe(409)
    expect(wasMailgunClientCreated()).toBe(false)
  })
})
