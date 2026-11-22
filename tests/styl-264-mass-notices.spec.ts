import { test, expect } from '@playwright/test'
import { NextRequest } from 'next/server'
import { previewSystemEmail } from '../src/lib/email/system/registry'
import { BATCH3_MASS_NOTICES } from '../src/lib/email/system/templates/batch-3'
import { isSystemEmailsBatch3Enabled } from '../src/lib/email/system/triggers/batch3/enabled'
import {
  massNoticeIdempotencyKey,
  runMassNotice,
  type AffectedAccountRecipient,
} from '../src/lib/email/system/triggers/batch3/mass-notice'
import {
  readSystemEmailTestDeliveries,
  resetSystemEmailTestState,
  wasMailgunClientCreated,
} from '../src/lib/email/system/deliver'
import { GET, POST } from '../src/app/api/superadmin/system-emails/notices/route'
import { createTestNormalUser, createTestSuperadminUser, type TestUserSession } from './test-auth-helper'
import { createClient } from '@supabase/supabase-js'

/**
 * STYL-264 batch 3a: legal mass notices #24–#31.
 * Local Supabase only. Mailgun stays on the Playwright mock.
 */

const TENANT_ID = '10000000-0000-0000-0000-000000000002'
const ALLOWED = 'test999@styleflo.ai'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'

process.env.PLAYWRIGHT_TEST = 'true'

const noticeBody = {
  supplierName: 'Example Supplier Ltd',
  supplierRole: 'stores conversation transcripts',
  changeSummary: 'a significant reduction in included knowledge items',
  effectiveDate: '1 April 2027',
  alternativeOffer: '',
  vatNumber: 'GB000000000',
  transfereeName: 'Example Transferee Ltd',
}

const postNotice = (token: string | null, body: Record<string, unknown>) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return POST(new NextRequest('http://localhost:3001/api/superadmin/system-emails/notices', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }))
}

test.describe('STYL-264 mass notice templates', () => {
  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    delete process.env.SYSTEM_EMAILS_BATCH3_ENABLED
    resetSystemEmailTestState()
  })

  test('batch 3 sending is off unless the flag is exactly true', () => {
    expect(isSystemEmailsBatch3Enabled({})).toBe(false)
    expect(isSystemEmailsBatch3Enabled({ SYSTEM_EMAILS_BATCH3_ENABLED: 'false' })).toBe(false)
    expect(isSystemEmailsBatch3Enabled({ SYSTEM_EMAILS_BATCH3_ENABLED: '1' })).toBe(false)
    expect(isSystemEmailsBatch3Enabled({ SYSTEM_EMAILS_BATCH3_ENABLED: 'true' })).toBe(true)
  })

  test('every mass notice renders subject, HTML and plain text from the redraft facts', () => {
    expect(BATCH3_MASS_NOTICES.map((notice) => notice.number)).toEqual([24, 25, 26, 27, 28, 29, 30, 31])
    for (const notice of BATCH3_MASS_NOTICES) {
      const rendered = previewSystemEmail(notice.key, {
        businessName: 'Harbour <Salon>',
        ...noticeBody,
        alternativeOffer: '',
      })
      expect(rendered, notice.key).not.toBeNull()
      expect(rendered?.subject.length).toBeGreaterThan(0)
      expect(rendered?.subject).not.toMatch(/[\r\n]/)
      expect(rendered?.text).toContain('Harbour <Salon>')
      expect(rendered?.text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(rendered?.text).toContain('cannot be switched off')
      expect(rendered?.html).toContain('Harbour &lt;Salon&gt;')
      expect(rendered?.html).not.toContain('<Salon>')
      expect(rendered?.text.toLowerCase()).not.toContain('article 33')
      expect(rendered?.text).not.toMatch(/\b72 hours\b/)
    }

    const subProcessor = previewSystemEmail('system.batch3.sub-processor-change', noticeBody)
    expect(subProcessor?.subject).toBe('Notice of a sub-processor change')
    expect(subProcessor?.text).toContain('clause 6A.3')
    expect(subProcessor?.text).toContain('clauses 6.2 and 6.4')
    expect(subProcessor?.text).toContain('at least 14 days')
    expect(subProcessor?.text).toContain('pro-rata refund')
    expect(subProcessor?.text).toContain('If you object, reply to this email.')

    const service = previewSystemEmail('system.batch3.service-change', noticeBody)
    expect(service?.text).toContain('clause 6B.2')
    expect(service?.text).toContain("one month's notice")

    const urgent = previewSystemEmail('system.batch3.urgent-change', { ...noticeBody, alternativeOffer: '' })
    expect(urgent?.text).toContain('clause 6B.3')
    expect(urgent?.text).toContain('We do not have an alternative to offer.')

    const terms = previewSystemEmail('system.batch3.terms-change', noticeBody)
    expect(terms?.text).toContain('Clause 9.1')

    const dpa = previewSystemEmail('system.batch3.dpa-change', noticeBody)
    expect(dpa?.text).toContain('Clause 13')

    const privacy = previewSystemEmail('system.batch3.privacy-change', noticeBody)
    expect(privacy?.text).toContain('Part H')

    const vat = previewSystemEmail('system.batch3.vat-registration', noticeBody)
    expect(vat?.text).toContain('clause 4A.3')
    expect(vat?.text).toContain('GB000000000')
    expect(vat?.text).not.toMatch(/20%/)

    const transfer = previewSystemEmail('system.batch3.contract-transfer', noticeBody)
    expect(transfer?.text).toContain('Clause 9.5')
    expect(transfer?.text).toContain('Example Transferee Ltd')
  })
})

test.describe('STYL-264 mass notice tool', () => {
  let superadmin: TestUserSession
  let normalUser: TestUserSession

  test.beforeAll(async () => {
    superadmin = await createTestSuperadminUser()
    normalUser = await createTestNormalUser()
  })

  test.afterAll(async () => {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await admin.from('system_email_log').delete().like('template_key', 'system.batch3.%')
    if (superadmin) await superadmin.cleanup()
    if (normalUser) await normalUser.cleanup()
  })

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    delete process.env.SYSTEM_EMAILS_BATCH3_ENABLED
    resetSystemEmailTestState()
  })

  test('a dry run lists recipients and sends nothing', async () => {
    const response = await postNotice(superadmin.token, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.sub-processor-change',
      data: noticeBody,
      dryRun: true,
      recipients: [{ email: 'injected@example.com', tenantId: TENANT_ID, businessName: 'Injected', userId: TENANT_ID }],
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dryRun).toBe(true)
    expect(body.sent).toBe(0)
    expect(body.enabled).toBe(false)
    expect(Array.isArray(body.recipients)).toBe(true)
    expect(body.recipients.some((row: { email: string }) => row.email === 'injected@example.com')).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    expect(wasMailgunClientCreated()).toBe(false)
  })

  test('confirm is refused while the flag is off', async () => {
    const response = await postNotice(superadmin.token, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.vat-registration',
      data: noticeBody,
      confirm: true,
    })
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.sent).toBe(0)
    expect(body.code).toBe('disabled')
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
  })

  test('the same notice id sends once', async () => {
    process.env.SYSTEM_EMAILS_BATCH3_ENABLED = 'true'
    const noticeId = crypto.randomUUID()
    const recipient: AffectedAccountRecipient = {
      tenantId: TENANT_ID,
      businessName: 'Harbour <Salon>',
      userId: '20000000-0000-0000-0000-000000000002',
      email: ALLOWED,
    }
    const first = await runMassNotice({
      noticeId,
      templateKey: 'system.batch3.contract-transfer',
      data: noticeBody,
      dryRun: false,
      recipients: [recipient],
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.sent).toBe(1)
    expect(first.duplicates).toBe(0)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    expect(readSystemEmailTestDeliveries()[0].to).toBe(ALLOWED)
    expect(readSystemEmailTestDeliveries()[0].text).toContain('Clause 9.5')
    expect(readSystemEmailTestDeliveries()[0].html).toContain('Harbour &lt;Salon&gt;')
    expect(wasMailgunClientCreated()).toBe(false)

    const second = await runMassNotice({
      noticeId,
      templateKey: 'system.batch3.contract-transfer',
      data: { ...noticeBody, transfereeName: 'A different company' },
      dryRun: false,
      recipients: [recipient],
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.sent).toBe(0)
    expect(second.duplicates).toBe(1)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    expect(massNoticeIdempotencyKey(noticeId, TENANT_ID).length).toBeLessThanOrEqual(200)
  })

  test('a normal user and a signed-out caller cannot send a notice', async () => {
    const catalogue = await GET(new NextRequest('http://localhost:3001/api/superadmin/system-emails/notices', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
    }))
    expect(catalogue.status).toBe(200)
    const listed = await catalogue.json()
    expect(listed.notices).toHaveLength(8)

    const member = await postNotice(normalUser.token, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.terms-change',
      data: noticeBody,
      dryRun: true,
    })
    expect(member.status).toBe(403)

    const anonymous = await postNotice(null, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.terms-change',
      data: noticeBody,
      confirm: true,
    })
    expect(anonymous.status).toBe(401)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
  })

  test('confirm and dry run together are rejected, and required facts cannot be omitted', async () => {
    const both = await postNotice(superadmin.token, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.dpa-change',
      data: noticeBody,
      dryRun: true,
      confirm: true,
    })
    expect(both.status).toBe(400)

    const missing = await postNotice(superadmin.token, {
      noticeId: crypto.randomUUID(),
      templateKey: 'system.batch3.sub-processor-change',
      data: { effectiveDate: '1 April 2027' },
      dryRun: true,
    })
    expect(missing.status).toBe(400)
    const body = await missing.json()
    expect(body.error).toContain('supplierName')
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
  })
})
