import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY } from '../src/lib/email/system/constants'
import { sendSystemEmail } from '../src/lib/email/system/send-system-email'
import { createTestNormalUser, createTestSuperadminUser, type TestUserSession } from './test-auth-helper'

/**
 * STYL-262 superadmin list, preview and resend.
 * Local Supabase only. The Playwright server mocks Mailgun.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TENANT_ID = '10000000-0000-0000-0000-000000000002'
const ALLOWED = 'test999@styleflo.ai'

process.env.PLAYWRIGHT_TEST = 'true'

function eventKey(label: string): string {
  return `pkg0-api-${label}-${crypto.randomUUID()}`
}

test.describe('STYL-262 system email superadmin API', () => {
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
    await admin.from('system_email_log').delete().like('idempotency_key', 'pkg0-api-%')
    await admin.from('system_email_log').delete().like('idempotency_key', 'resend:%')
    if (superadmin) await superadmin.cleanup()
    if (normalUser) await normalUser.cleanup()
  })

  test('preview, list and resend are superadmin only', async ({ request }) => {
    const idempotencyKey = eventKey('send')
    const sent = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      data: { businessName: 'Harbour Salon', recipientName: 'Alex' },
      idempotencyKey,
    })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return

    const unauthList = await request.get('/api/superadmin/system-emails')
    expect(unauthList.status()).toBe(401)

    const normalList = await request.get('/api/superadmin/system-emails', {
      headers: { Authorization: `Bearer ${normalUser.token}` },
    })
    expect(normalList.status()).toBe(403)

    const adminList = await request.get('/api/superadmin/system-emails', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
    })
    expect(adminList.status()).toBe(200)
    const listed = await adminList.json()
    expect(listed.emails.some((row: { idempotencyKey: string }) => row.idempotencyKey === idempotencyKey)).toBe(true)
    expect(listed.templates.some((template: { key: string }) => template.key === EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)).toBe(true)

    const unauthPreview = await request.post('/api/superadmin/system-emails/preview', {
      data: { templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY },
    })
    expect(unauthPreview.status()).toBe(401)

    const normalPreview = await request.post('/api/superadmin/system-emails/preview', {
      headers: { Authorization: `Bearer ${normalUser.token}` },
      data: {
        templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
        data: { recipientName: '<b>Sam</b>', businessName: 'Harbour Salon' },
      },
    })
    expect(normalPreview.status()).toBe(403)

    const preview = await request.post('/api/superadmin/system-emails/preview', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: {
        templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
        data: { recipientName: '<b>Sam</b>', businessName: 'Harbour Salon' },
      },
    })
    expect(preview.status()).toBe(200)
    const previewBody = await preview.json()
    expect(previewBody.subject).toContain('Harbour Salon')
    expect(previewBody.html).toContain('&lt;b&gt;Sam&lt;/b&gt;')
    expect(previewBody.html).not.toContain('<b>Sam</b>')
    expect(previewBody.text).toContain('Reply to this email and it will reach StyleFlo support.')

    const missing = await request.post('/api/superadmin/system-emails/preview', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: { templateKey: 'system.batch1.not-built' },
    })
    expect(missing.status()).toBe(404)

    const normalResend = await request.post('/api/superadmin/system-emails/resend', {
      headers: { Authorization: `Bearer ${normalUser.token}` },
      data: { logId: sent.logId, idempotencyKey: eventKey('denied') },
    })
    expect(normalResend.status()).toBe(403)

    const resendKey = eventKey('resend')
    const resent = await request.post('/api/superadmin/system-emails/resend', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: { logId: sent.logId, idempotencyKey: resendKey },
    })
    expect(resent.status()).toBe(200)
    const resentBody = await resent.json()
    expect(resentBody.duplicate).toBe(false)
    expect(String(resentBody.providerId)).toContain('playwright-mock-')

    const resentAgain = await request.post('/api/superadmin/system-emails/resend', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: { logId: sent.logId, idempotencyKey: resendKey },
    })
    expect(resentAgain.status()).toBe(200)
    const resentAgainBody = await resentAgain.json()
    expect(resentAgainBody.duplicate).toBe(true)
    expect(resentAgainBody.logId).toBe(resentBody.logId)

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: resendRows } = await admin.from('system_email_log').select('id').eq('idempotency_key', resendKey)
    expect(resendRows).toHaveLength(1)
  })
})
