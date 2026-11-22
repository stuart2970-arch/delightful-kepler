import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY, SYSTEM_EMAIL_REPLY_TO } from '../src/lib/email/system/constants'
import {
  assertSystemEmailRecipientAllowed,
} from '../src/lib/email/system/guard'
import {
  assertUniqueTemplateKeys,
  getSystemEmailTemplate,
  listSystemEmailTemplates,
  previewSystemEmail,
} from '../src/lib/email/system/registry'
import { sendSystemEmail } from '../src/lib/email/system/send-system-email'
import { resendSystemEmail } from '../src/lib/email/system/log'
import {
  readSystemEmailTestDeliveries,
  resetSystemEmailTestState,
  setSystemEmailTransportForTests,
  wasMailgunClientCreated,
} from '../src/lib/email/system/deliver'
import { batch1Templates } from '../src/lib/email/system/templates/batch-1'
import { batch2Templates } from '../src/lib/email/system/templates/batch-2'
import { batch3Templates } from '../src/lib/email/system/templates/batch-3'
import { batch4Templates } from '../src/lib/email/system/templates/batch-4'
import { createTestNormalUser, createTestSuperadminUser, type TestUserSession } from './test-auth-helper'
import type { SystemEmailTemplate } from '../src/lib/email/system/types'

/**
 * STYL-262 reusable system-email layer.
 * Local Supabase only. Mailgun is mocked while PLAYWRIGHT_TEST=true.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TENANT_ID = '10000000-0000-0000-0000-000000000002'
const ALLOWED = 'test999@styleflo.ai'
const ALLOWED_OWNER = 'stuart.magowan.sharp@gmail.com'

process.env.PLAYWRIGHT_TEST = 'true'

function eventKey(label: string): string {
  return `pkg0-${label}-${crypto.randomUUID()}`
}

function service(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function asUser(token: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function localDbContainer(): string | null {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    return names.split('\n').map((name) => name.trim()).find((name) => name.startsWith('supabase_db_')) || null
  } catch {
    return null
  }
}

function runLocalSql(sql: string): string {
  const container = localDbContainer()
  if (!container) throw new Error('Local Supabase database container is not running')
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A'],
    { input: sql, encoding: 'utf8' },
  )
}

test.describe('STYL-262 system email registry', () => {
  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    resetSystemEmailTestState()
  })

  test('production registry is only the four batch files', () => {
    const env = { APP_ENV: 'production', PLAYWRIGHT_TEST: '' } as NodeJS.ProcessEnv
    const keys = listSystemEmailTemplates(env).map((template) => template.key)
    expect(keys).toEqual([
      ...batch1Templates.map((template) => template.key),
      ...batch2Templates.map((template) => template.key),
      ...batch3Templates.map((template) => template.key),
      ...batch4Templates.map((template) => template.key),
    ])
    expect(keys).not.toContain(EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)
    expect(getSystemEmailTemplate(EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY, env)).toBeNull()
  })

  test('the example template is registered only for Playwright', () => {
    const keys = listSystemEmailTemplates({ PLAYWRIGHT_TEST: 'true' } as NodeJS.ProcessEnv).map((template) => template.key)
    expect(keys).toContain(EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)
    expect(keys.filter((key) => key === EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)).toHaveLength(1)
  })

  test('duplicate template keys are rejected', () => {
    const duplicate: SystemEmailTemplate = {
      key: 'system.test.example',
      sampleData: {},
      render: () => ({ subject: 'Subject', html: '<p>Hello</p>', text: 'Hello' }),
    }
    expect(() => assertUniqueTemplateKeys([duplicate, duplicate])).toThrow(/Duplicate system email template key/)
  })

  test('preview renders subject, HTML and plain text with escaped sample data', () => {
    const rendered = previewSystemEmail(
      EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      { recipientName: '<b>Sam</b>', businessName: 'Harbour Salon' },
      { PLAYWRIGHT_TEST: 'true' } as NodeJS.ProcessEnv,
    )
    expect(rendered).not.toBeNull()
    expect(rendered?.subject).toBe('StyleFlo system email for Harbour Salon')
    expect(rendered?.text).toContain('Hello <b>Sam</b>,')
    expect(rendered?.text).toContain('Reply to this email and it will reach StyleFlo support.')
    expect(rendered?.html).toContain('&lt;b&gt;Sam&lt;/b&gt;')
    expect(rendered?.html).not.toContain('<b>Sam</b>')
    expect(rendered?.html).toContain('StyleFlo')
    expect(rendered?.text).not.toContain('<p>')
  })

  test('non-production guard allows only the approved inboxes', () => {
    const blocked = assertSystemEmailRecipientAllowed('customer@example.com', { APP_ENV: 'test' })
    expect(blocked.ok).toBe(false)
    expect(assertSystemEmailRecipientAllowed(ALLOWED, { APP_ENV: 'staging' }).ok).toBe(true)
    expect(assertSystemEmailRecipientAllowed(ALLOWED_OWNER, { APP_ENV: 'development' }).ok).toBe(true)
    expect(assertSystemEmailRecipientAllowed('customer@example.com', { APP_ENV: 'production' }).ok).toBe(true)
    expect(assertSystemEmailRecipientAllowed('customer@example.com', { NODE_ENV: 'production' }).ok).toBe(true)
    expect(assertSystemEmailRecipientAllowed('customer@example.com', { APP_ENV: 'staging', NODE_ENV: 'production' }).ok).toBe(false)
  })

  test('a transport override cannot be installed outside Playwright', () => {
    const previous = process.env.PLAYWRIGHT_TEST
    delete process.env.PLAYWRIGHT_TEST
    try {
      expect(() => setSystemEmailTransportForTests(async () => ({ id: 'should-not-install' }))).toThrow(/Playwright/)
    } finally {
      process.env.PLAYWRIGHT_TEST = previous
    }
  })
})

test.describe('STYL-262 system email send, log and superadmin', () => {
  let superadmin: TestUserSession
  let normalUser: TestUserSession

  test.beforeAll(async () => {
    superadmin = await createTestSuperadminUser()
    normalUser = await createTestNormalUser()
  })

  test.afterAll(async () => {
    const admin = service()
    await admin.from('system_email_log').delete().eq('template_key', EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)
    if (superadmin) await superadmin.cleanup()
    if (normalUser) await normalUser.cleanup()
  })

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    resetSystemEmailTestState()
  })

  test('the log table is service-role write and superadmin read', () => {
    const policies = runLocalSql(`
      SELECT policyname || '|' || cmd || '|' || coalesce(roles::text, '') || '|' || coalesce(qual, '')
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'system_email_log'
      ORDER BY policyname;
    `).trim()
    expect(policies).toContain('select_superadmin_system_email_log|SELECT|{authenticated}|')
    expect(policies).toContain('is_super_admin')
    expect(policies).toContain('system_email_log_service_role_all|ALL|{service_role}|true')
    expect(policies).not.toContain('select_superadmin_system_email_log|SELECT|{authenticated}|true')

    const unique = runLocalSql(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'system_email_log'
        AND indexdef ILIKE '%idempotency_key%';
    `)
    expect(unique.toLowerCase()).toContain('unique')

    const rls = runLocalSql(`
      SELECT relrowsecurity::text
      FROM pg_class
      WHERE oid = 'public.system_email_log'::regclass;
    `).trim()
    expect(rls).toBe('true')

    const grants = runLocalSql(`
      SELECT grantee || '|' || privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'system_email_log'
      ORDER BY grantee, privilege_type;
    `)
    expect(grants).toContain('authenticated|SELECT')
    expect(grants).not.toContain('authenticated|INSERT')
    expect(grants).not.toContain('anon|')
    expect(grants).toContain('service_role|INSERT')
  })

  test('an idempotency key sends once, writes a log row, and does not call Mailgun', async () => {
    const idempotencyKey = eventKey('once')
    const first = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      data: { recipientName: '<b>Sam</b>', businessName: 'Harbour Salon' },
      idempotencyKey,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.duplicate).toBe(false)
    expect(first.status).toBe('sent')
    expect(first.providerId?.startsWith('playwright-mock-')).toBe(true)

    const deliveries = readSystemEmailTestDeliveries()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].to).toBe(ALLOWED)
    expect(deliveries[0].replyTo).toBe(SYSTEM_EMAIL_REPLY_TO)
    expect(deliveries[0].text).toContain('Harbour Salon')
    expect(deliveries[0].html).toContain('&lt;b&gt;Sam&lt;/b&gt;')
    expect(wasMailgunClientCreated()).toBe(false)

    const admin = service()
    const { data: rows, error } = await admin
      .from('system_email_log')
      .select('id, status, provider_id, recipient, template_key, tenant_id')
      .eq('idempotency_key', idempotencyKey)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows?.[0].status).toBe('sent')
    expect(rows?.[0].provider_id).toBe(first.providerId)
    expect(rows?.[0].recipient).toBe(ALLOWED)
    expect(rows?.[0].template_key).toBe(EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY)
    expect(rows?.[0].tenant_id).toBe(TENANT_ID)

    const second = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      data: { recipientName: 'Someone else', businessName: 'Other Salon' },
      idempotencyKey,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.duplicate).toBe(true)
    expect(second.logId).toBe(first.logId)
    expect(second.providerId).toBe(first.providerId)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)

    const { data: after } = await admin
      .from('system_email_log')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
    expect(after).toHaveLength(1)
  })

  test('the owner inbox is allowed and a stranger is not recorded', async () => {
    const allowed = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED_OWNER,
      idempotencyKey: eventKey('owner'),
    })
    expect(allowed.ok).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    expect(wasMailgunClientCreated()).toBe(false)

    resetSystemEmailTestState()
    const blockedKey = eventKey('blocked')
    const blocked = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: 'customer@example.com',
      idempotencyKey: blockedKey,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.code).toBe('recipient_not_allowed')
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    const { data } = await service()
      .from('system_email_log')
      .select('id')
      .eq('idempotency_key', blockedKey)
    expect(data ?? []).toEqual([])
  })

  test('production allows other recipients and still uses the Playwright mail mock', async () => {
    const previousApp = process.env.APP_ENV
    const previousNode = process.env.NODE_ENV
    process.env.APP_ENV = 'production'
    try {
      const result = await sendSystemEmail({
        templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
        tenantId: TENANT_ID,
        to: 'customer@example.com',
        idempotencyKey: eventKey('prod'),
      })
      expect(result.ok).toBe(true)
      expect(wasMailgunClientCreated()).toBe(false)
      expect(readSystemEmailTestDeliveries()[0]?.to).toBe('customer@example.com')
    } finally {
      if (previousApp === undefined) delete process.env.APP_ENV
      else process.env.APP_ENV = previousApp
      if (previousNode === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNode
    }
  })

  test('a failed provider attempt keeps the idempotency key and does not send again', async () => {
    let calls = 0
    setSystemEmailTransportForTests(async () => {
      calls += 1
      throw new Error('provider down')
    })
    const idempotencyKey = eventKey('failed')
    const input = {
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      idempotencyKey,
    }
    const first = await sendSystemEmail(input)
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.code).toBe('send_failed')
    expect(calls).toBe(1)

    const { data } = await service()
      .from('system_email_log')
      .select('status, provider_id, error_message')
      .eq('idempotency_key', idempotencyKey)
      .single()
    expect(data?.status).toBe('failed')
    expect(data?.provider_id).toBeNull()
    expect(data?.error_message).toBe('The email provider did not accept the message.')

    const second = await sendSystemEmail(input)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.duplicate).toBe(true)
      expect(second.status).toBe('failed')
    }
    expect(calls).toBe(1)
  })

  test('resend writes a new row once per key and replays the stored template data', async () => {
    const original = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      data: { recipientName: 'Alex', businessName: 'Harbour Salon' },
      idempotencyKey: eventKey('original'),
    })
    expect(original.ok).toBe(true)
    if (!original.ok) return

    const resendKey = eventKey('resend')
    const resent = await resendSystemEmail({ logId: original.logId, idempotencyKey: resendKey })
    expect(resent.ok).toBe(true)
    if (!resent.ok) return
    expect(resent.duplicate).toBe(false)
    expect(resent.providerId?.startsWith('playwright-mock-')).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(2)
    expect(readSystemEmailTestDeliveries()[1].text).toContain('Harbour Salon')
    expect(readSystemEmailTestDeliveries()[1].replyTo).toBe(SYSTEM_EMAIL_REPLY_TO)

    const again = await resendSystemEmail({ logId: original.logId, idempotencyKey: resendKey })
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.duplicate).toBe(true)
      expect(again.logId).toBe(resent.logId)
    }
    expect(readSystemEmailTestDeliveries()).toHaveLength(2)

    const { data } = await service()
      .from('system_email_log')
      .select('id, resend_of_id')
      .eq('idempotency_key', resendKey)
    expect(data).toHaveLength(1)
    expect(data?.[0].resend_of_id).toBe(original.logId)
  })

  test('row level security hides the log from anon and normal users', async () => {
    const idempotencyKey = eventKey('rls')
    const sent = await sendSystemEmail({
      templateKey: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      tenantId: TENANT_ID,
      to: ALLOWED,
      idempotencyKey,
    })
    expect(sent.ok).toBe(true)

    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: anonRows } = await anon.from('system_email_log').select('id').eq('idempotency_key', idempotencyKey)
    expect(anonRows ?? []).toEqual([])

    const member = asUser(normalUser.token)
    const { data: memberRows } = await member.from('system_email_log').select('id').eq('idempotency_key', idempotencyKey)
    expect(memberRows ?? []).toEqual([])
    const { error: insertError } = await member.from('system_email_log').insert({
      recipient: ALLOWED,
      template_key: EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY,
      status: 'sent',
      idempotency_key: eventKey('member-insert'),
    })
    expect(insertError).toBeTruthy()

    const adminUser = asUser(superadmin.token)
    const { data: visible, error: visibleError } = await adminUser
      .from('system_email_log')
      .select('idempotency_key')
      .eq('idempotency_key', idempotencyKey)
    expect(visibleError).toBeNull()
    expect(visible).toHaveLength(1)
  })
})
