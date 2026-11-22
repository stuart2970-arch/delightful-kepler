import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '../src/app/api/account/email-toggles/route'
import { bookingConfirmationFromName, sendBookingConfirmationEmail } from '../src/lib/booking/booking-confirmation-email'
import { sendConsolidatedLeadEmail } from '../src/lib/lead-notifier'
import { createTestUser, type TestUserSession } from './test-auth-helper'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const root = path.resolve(__dirname, '..')

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-265 batch 4a email toggles and auth templates', () => {
  test.beforeAll(() => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    expect(supabaseUrl).not.toContain('lriugykhrfnnouexqqhm')
  })

  test('new accounts keep enquiry and booking emails on', async () => {
    const admin = adminClient()
    const suffix = `${Date.now()}`
    const { data, error } = await admin
      .from('tenants')
      .insert({ company_name: `Toggle Default ${suffix}`, slug: `toggle-default-${suffix}` })
      .select('id, enquiry_details_email_enabled, booking_confirmation_email_enabled')
      .single()
    expect(error).toBeNull()
    expect(data?.enquiry_details_email_enabled).toBe(true)
    expect(data?.booking_confirmation_email_enabled).toBe(true)
    if (data?.id) await admin.from('tenants').delete().eq('id', data.id)
  })

  test('turning enquiry emails off stops the lead email before it is marked sent', async () => {
    const admin = adminClient()
    const suffix = `${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ company_name: `Toggle Off ${suffix}`, slug: `toggle-off-${suffix}` })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    const tenantId = tenant!.id
    let owner: TestUserSession | null = null
    const previousKey = process.env.MAILGUN_API_KEY
    const previousDomain = process.env.MAILGUN_DOMAIN
    process.env.MAILGUN_API_KEY = 'mock_mailgun_api_key_for_local_testing'
    process.env.MAILGUN_DOMAIN = 'example.test'

    try {
      owner = await createTestUser({ tenantId, role: 'owner' })
      const off = await PATCH(new NextRequest('http://localhost:3001/api/account/email-toggles', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${owner.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enquiryDetailsEmailEnabled: false }),
      }))
      expect(off.status).toBe(200)
      const offBody = await off.json()
      expect(offBody.enquiryDetailsEmailEnabled).toBe(false)
      expect(offBody.bookingConfirmationEmailEnabled).toBe(true)

      const { data: chatbot, error: botErr } = await admin
        .from('chatbots')
        .insert({
          tenant_id: tenantId,
          name: 'Toggle Bot',
          configuration_json: { admin_email: 'test999@styleflo.ai' },
        })
        .select('id')
        .single()
      expect(botErr).toBeNull()

      const { data: conversation, error: convErr } = await admin
        .from('conversations')
        .insert({
          tenant_id: tenantId,
          chatbot_id: chatbot!.id,
          user_session_id: `toggle-${suffix}`,
          channel: 'web_chat',
        })
        .select('id')
        .single()
      expect(convErr).toBeNull()

      const { error: msgErr } = await admin.from('messages').insert({
        tenant_id: tenantId,
        conversation_id: conversation!.id,
        sender_type: 'user',
        text_content: `Please book a trim. Email lead.${suffix}@example.test`,
      })
      expect(msgErr).toBeNull()

      const logs: string[] = []
      const originalLog = console.log
      const originalError = console.error
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
        originalLog(...args)
      }
      console.error = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
        originalError(...args)
      }
      try {
        const sentWhileOff = await sendConsolidatedLeadEmail({
          tenantId,
          chatbotId: chatbot!.id,
          conversationId: conversation!.id,
          channelType: 'chat',
        })
        expect(sentWhileOff).toBe(false)
        expect(logs.some((line) => line.includes('Enquiry details email is turned off'))).toBe(true)
        expect(logs.some((line) => line.includes('Mailgun'))).toBe(false)

        const on = await PATCH(new NextRequest('http://localhost:3001/api/account/email-toggles', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${owner.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enquiryDetailsEmailEnabled: true }),
        }))
        expect(on.status).toBe(200)
        delete process.env.MAILGUN_API_KEY
        delete process.env.MAILGUN_DOMAIN
        logs.length = 0
        const sentWhileOn = await sendConsolidatedLeadEmail({
          tenantId,
          chatbotId: chatbot!.id,
          conversationId: conversation!.id,
          channelType: 'chat',
        })
        expect(sentWhileOn).toBe(false)
        expect(logs.some((line) => line.includes('Mailgun API Key or Domain missing'))).toBe(true)
        expect(logs.some((line) => line.includes('turned off'))).toBe(false)
      } finally {
        console.log = originalLog
        console.error = originalError
      }
    } finally {
      if (previousKey === undefined) delete process.env.MAILGUN_API_KEY
      else process.env.MAILGUN_API_KEY = previousKey
      if (previousDomain === undefined) delete process.env.MAILGUN_DOMAIN
      else process.env.MAILGUN_DOMAIN = previousDomain
      if (owner) await owner.cleanup()
      await admin.from('tenants').delete().eq('id', tenantId)
    }
  })

  test('booking confirmation uses the business name and can be turned off', async () => {
    expect(bookingConfirmationFromName('Harbour Salon')).toBe('"Harbour Salon" via StyleFlo')
    expect(bookingConfirmationFromName('Smith, Jones & Co')).toBe('"Smith, Jones & Co" via StyleFlo')
    expect(bookingConfirmationFromName('  ')).toBe('"the small business" via StyleFlo')
    expect(bookingConfirmationFromName('Bad <name>\n"quote"\\')).toBe('"Bad name \\"quote\\"\\\\" via StyleFlo')
    expect(bookingConfirmationFromName('Bad <name>\n')).not.toContain('<')
    expect(bookingConfirmationFromName('Bad <name>\n')).not.toContain('\n')

    const admin = adminClient()
    const suffix = `${Date.now()}`
    const { data: tenant, error } = await admin
      .from('tenants')
      .insert({
        company_name: `Book Toggle ${suffix}`,
        slug: `book-toggle-${suffix}`,
        booking_confirmation_email_enabled: false,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const previousKey = process.env.MAILGUN_API_KEY
    const previousDomain = process.env.MAILGUN_DOMAIN
    process.env.MAILGUN_API_KEY = 'mock_mailgun_api_key_for_local_testing'
    process.env.MAILGUN_DOMAIN = 'example.test'
    try {
      await expect(sendBookingConfirmationEmail({
        customerName: 'Alex',
        customerEmail: 'test999@styleflo.ai',
        serviceName: 'Cut',
        staffName: 'Sam',
        formattedStart: '22 November 2026, 10:00',
        businessName: 'Harbour Salon',
        tenantId: tenant!.id,
      })).resolves.toBeUndefined()
    } finally {
      if (previousKey === undefined) delete process.env.MAILGUN_API_KEY
      else process.env.MAILGUN_API_KEY = previousKey
      if (previousDomain === undefined) delete process.env.MAILGUN_DOMAIN
      else process.env.MAILGUN_DOMAIN = previousDomain
      await admin.from('tenants').delete().eq('id', tenant!.id)
    }
  })

  test('the account route rejects anonymous and non-boolean updates', async () => {
    const missing = await GET(new NextRequest('http://localhost:3001/api/account/email-toggles'))
    expect(missing.status).toBe(401)
    const admin = adminClient()
    const suffix = `${Date.now()}`
    const { data: tenant } = await admin
      .from('tenants')
      .insert({ company_name: `Toggle Auth ${suffix}`, slug: `toggle-auth-${suffix}` })
      .select('id')
      .single()
    const owner = await createTestUser({ tenantId: tenant!.id, role: 'owner' })
    try {
      const bad = await PATCH(new NextRequest('http://localhost:3001/api/account/email-toggles', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${owner.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enquiryDetailsEmailEnabled: 'no' }),
      }))
      expect(bad.status).toBe(400)
    } finally {
      await owner.cleanup()
      await admin.from('tenants').delete().eq('id', tenant!.id)
    }
  })

  test('auth templates are StyleFlo files and do not enable hosted SMTP', () => {
    const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8')
    expect(config).toContain('content_path = "./supabase/templates/confirmation.html"')
    expect(config).toContain('content_path = "./supabase/templates/magic_link.html"')
    expect(config).toContain('content_path = "./supabase/templates/recovery.html"')
    expect(config).toContain('# [auth.email.smtp]')
    const dashboard = readFileSync(path.join(root, 'src/components/DashboardClient.tsx'), 'utf8')
    expect(dashboard).toContain('<EmailDeliveryToggles accountEmail={userEmail} />')
    for (const file of ['confirmation.html', 'magic_link.html', 'recovery.html']) {
      const html = readFileSync(path.join(root, 'supabase/templates', file), 'utf8')
      expect(html).toContain('{{ .ConfirmationURL }}')
      expect(html).toContain('{{ .Email }}')
      expect(html).toContain('StyleFlo')
      expect(html).toContain('lang="en-GB"')
      expect(html).not.toContain('tkoasyjvrgaglofpzduq')
      expect(html.toLowerCase()).not.toContain('canceled')
    }
  })
})
