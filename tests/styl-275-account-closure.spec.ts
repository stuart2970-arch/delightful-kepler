import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  openAccountClosure,
  reopenAccountClosure,
  runAccountClosureSweep,
} from '../src/lib/account-closure/sweep'
import type { NumberReleaser } from '../src/lib/account-closure/release'
import {
  ACCOUNT_CLOSURE_REMINDER_AFTER_CLOSE_DAYS,
  ACCOUNT_CLOSURE_RETENTION_DAYS,
  addClosureDays,
  closureMilestones,
  failedPaymentClosureDays,
  formatClosureDate,
  isDeletionDue,
  isReminderDue,
  isReopenAllowed,
} from '../src/lib/account-closure/schedule'
import {
  FAILED_PAYMENT_CANCEL_AFTER_DAYS,
  FAILED_PAYMENT_DAY_MS,
  elapsedFailedPaymentDays,
} from '../src/lib/billing/failed-payment/evaluate'
import { POST as sweepPost } from '../src/app/api/billing/failed-payment-sweep/route'
import {
  createFailedPaymentStripeClient,
  setFailedPaymentStripeClientForTests,
} from '../src/lib/billing/failed-payment/stripe-client'
import type { FailedPaymentStripeGateway } from '../src/lib/billing/failed-payment/stripe-client'
import { batch1Templates, BATCH1_CLOSURE_DELETED, BATCH1_CLOSURE_REMINDER } from '../src/lib/email/system/templates/batch-1'
import { readSystemEmailTestDeliveries, resetSystemEmailTestState } from '../src/lib/email/system/deliver'
import { releaseTwilioNumber, releaseVapiNumber, telephonyReleaseCallLog } from '../src/lib/telephony/release-vendors'

/**
 * STYL-275, STYL-276 and STYL-277. Local Supabase only.
 * Mailgun, Twilio and Vapi stay mocked while PLAYWRIGHT_TEST=true.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TENANT = '27500000-0000-4000-8000-000000000275'
const INBOX = 'test999@styleflo.ai'
const DAY = FAILED_PAYMENT_DAY_MS
const root = process.cwd()

process.env.PLAYWRIGHT_TEST = 'true'

function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function localSupabase(): void {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').toLowerCase()
  expect(url.includes('127.0.0.1') || url.includes('localhost')).toBe(true)
  expect(url.includes('tkoasyjvrgaglofpzduq')).toBe(false)
}

function clock(closedAt: string, extra: Partial<{ reminderSentAt: string | null; deletedAt: string | null; reopenedAt: string | null }> = {}) {
  return {
    closedAt,
    reminderSentAt: extra.reminderSentAt ?? null,
    deletedAt: extra.deletedAt ?? null,
    reopenedAt: extra.reopenedAt ?? null,
  }
}

test.describe('STYL-275 closure day maths', () => {
  const closedAt = new Date('2026-01-01T00:00:00.000Z')

  test('reminder is day 24 and deletion is day 31', () => {
    expect(ACCOUNT_CLOSURE_REMINDER_AFTER_CLOSE_DAYS).toBe(24)
    expect(ACCOUNT_CLOSURE_RETENTION_DAYS).toBe(31)
    const milestones = closureMilestones(closedAt)
    expect(milestones.reminderAt.toISOString()).toBe('2026-01-25T00:00:00.000Z')
    expect(milestones.deletionAt.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(formatClosureDate(milestones.deletionAt)).toBe('1 February 2026')
    expect(isReminderDue(clock(closedAt.toISOString()), new Date(closedAt.getTime() + 24 * DAY - 1))).toBe(false)
    expect(isReminderDue(clock(closedAt.toISOString()), milestones.reminderAt)).toBe(true)
    expect(isDeletionDue(clock(closedAt.toISOString()), new Date(closedAt.getTime() + 31 * DAY - 1))).toBe(false)
    expect(isDeletionDue(clock(closedAt.toISOString()), milestones.deletionAt)).toBe(true)
  })

  test('a failed payment cancels on day 37 and is deleted on day 68', () => {
    const days = failedPaymentClosureDays()
    expect(FAILED_PAYMENT_CANCEL_AFTER_DAYS).toBe(37)
    expect(days).toEqual({ cancelDay: 37, reminderDay: 61, deletionDay: 68 })
    const firstFailed = new Date('2026-03-01T00:00:00.000Z')
    const cancelAt = addClosureDays(firstFailed, 37)
    expect(elapsedFailedPaymentDays(firstFailed, cancelAt)).toBe(37)
    const milestones = closureMilestones(cancelAt)
    expect(elapsedFailedPaymentDays(firstFailed, milestones.reminderAt)).toBe(61)
    expect(elapsedFailedPaymentDays(firstFailed, milestones.deletionAt)).toBe(68)
  })

  test('reopening inside the 31 days cancels deletion, and day 31 is too late', () => {
    expect(isReopenAllowed(closedAt, new Date(closedAt.getTime() + 30 * DAY))).toBe(true)
    expect(isReopenAllowed(closedAt, addClosureDays(closedAt, 31))).toBe(false)
    const reopened = clock(closedAt.toISOString(), { reopenedAt: '2026-01-20T00:00:00.000Z' })
    expect(isReminderDue(reopened, addClosureDays(closedAt, 24))).toBe(false)
    expect(isDeletionDue(reopened, addClosureDays(closedAt, 31))).toBe(false)
    const sent = clock(closedAt.toISOString(), { reminderSentAt: '2026-01-25T00:00:00.000Z' })
    expect(isReminderDue(sent, addClosureDays(closedAt, 25))).toBe(false)
    const deleted = clock(closedAt.toISOString(), { deletedAt: '2026-02-01T00:00:00.000Z' })
    expect(isDeletionDue(deleted, addClosureDays(closedAt, 40))).toBe(false)
  })
})

test.describe('STYL-276 closure emails', () => {
  test('the reminder and confirmation have a data-only version', () => {
    const previews = readFileSync(join(root, 'docs/system-emails/batch-1-previews.md'), 'utf8')
    const reminder = batch1Templates.find((template) => template.key === BATCH1_CLOSURE_REMINDER)!
    const confirmation = batch1Templates.find((template) => template.key === BATCH1_CLOSURE_DELETED)!
    const numberedReminder = reminder.render(reminder.sampleData).text
    const dataOnlyReminder = reminder.render({ ...reminder.sampleData, hasNumber: 'false', phoneNumber: '' }).text
    const numberedConfirmation = confirmation.render(confirmation.sampleData).text
    const dataOnlyConfirmation = confirmation.render({ ...confirmation.sampleData, hasNumber: 'false', phoneNumber: '' }).text

    expect(numberedReminder).toContain('1 February 2026')
    expect(numberedReminder).toContain('release the StyleFlo number 01632 960123')
    expect(numberedReminder).toContain('keeps the data and the number')
    expect(dataOnlyReminder).toContain('no StyleFlo number to release')
    expect(dataOnlyReminder).not.toContain('01632 960123')
    expect(numberedConfirmation).toContain('We have released the StyleFlo number 01632 960123')
    expect(dataOnlyConfirmation).toContain('no StyleFlo number to release')
    expect(dataOnlyConfirmation).not.toContain('01632 960123')
    for (const text of [numberedReminder, dataOnlyReminder, numberedConfirmation, dataOnlyConfirmation]) {
      expect(text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(text.toLowerCase()).not.toMatch(/\bport(?:ing|ed| out)?\b/)
      expect(previews).toContain(text)
    }
  })
})

test.describe('STYL-275 closure sweep', () => {
  const previousFlag = process.env.FAILED_PAYMENT_FLOW_ENABLED

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    process.env.FAILED_PAYMENT_FLOW_ENABLED = 'true'
    resetSystemEmailTestState()
    telephonyReleaseCallLog.reset()
  })

  test.afterEach(() => {
    if (previousFlag === undefined) delete process.env.FAILED_PAYMENT_FLOW_ENABLED
    else process.env.FAILED_PAYMENT_FLOW_ENABLED = previousFlag
  })

  async function ensureTenant(admin: SupabaseClient, numbers: { shadow?: string | null; mobile?: string | null }) {
    localSupabase()
    const { data } = await admin.from('tenants').select('id').eq('id', TENANT).maybeSingle()
    if (!data) {
      const { error } = await admin.from('tenants').insert({
        id: TENANT,
        tenant_id: TENANT,
        company_name: 'Harbour Salon',
        slug: 'harbour-salon-275',
        plan_tier: 'foundation',
        is_active: false,
        subscription_status: 'cancelled',
      })
      if (error) throw new Error(error.message)
    }
    const { error: updateError } = await admin.from('tenants').update({
      company_name: 'Harbour Salon',
      is_active: false,
      subscription_status: 'cancelled',
      twilio_shadow_number: numbers.shadow ?? null,
      twilio_mobile_number: numbers.mobile ?? null,
      has_landline: Boolean(numbers.shadow),
      has_mobile: Boolean(numbers.mobile),
    }).eq('id', TENANT)
    if (updateError) throw new Error(updateError.message)

    const created = await admin.auth.admin.createUser({
      email: INBOX,
      password: 'Password123!',
      email_confirm: true,
    })
    let userId = created.data.user?.id || ''
    if (!userId) {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      userId = listed.data.users.find((user) => user.email?.toLowerCase() === INBOX)?.id || ''
    }
    expect(userId).toBeTruthy()
    const { error: profileError } = await admin.from('profiles').upsert({
      id: userId,
      tenant_id: TENANT,
      role: 'owner',
      is_super_admin: false,
    })
    if (profileError) throw new Error(profileError.message)
  }

  async function cleanup(admin: SupabaseClient) {
    await admin.from('services').delete().eq('tenant_id', TENANT)
    await admin.from('system_email_log').delete().eq('tenant_id', TENANT)
    await admin.from('account_closures').delete().eq('tenant_id', TENANT)
    await admin.from('tenant_phone_number_purchases').delete().eq('tenant_id', TENANT)
    await admin.from('tenants').update({
      twilio_shadow_number: null,
      twilio_mobile_number: null,
      is_active: true,
      subscription_status: 'active',
    }).eq('id', TENANT)
  }

  function countingReleaser(): { releaser: NumberReleaser; calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      releaser: {
        async releaseTwilio(phoneNumber: string) {
          calls.push(`twilio:${phoneNumber}`)
        },
        async releaseVapi(phoneNumber: string) {
          calls.push(`vapi:${phoneNumber}`)
        },
      },
    }
  }

  test('a reminder is sent once, and reopening cancels deletion', async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required')
    const admin = adminClient()
    await ensureTenant(admin, {})
    await cleanup(admin)
    await ensureTenant(admin, {})
    const now = new Date('2026-06-01T00:00:00.000Z')
    const closedAt = addClosureDays(now, -24).toISOString()
    const opened = await openAccountClosure(admin, {
      tenantId: TENANT,
      reason: 'plan_cancelled',
      closedAt,
      sourceKey: `plan:test-275-reminder`,
    })
    expect(opened.ok && opened.skipped === null && opened.created).toBe(true)
    if (!opened.ok || opened.skipped) return
    expect(opened.row.number_state).toBe('none')

    const { releaser, calls } = countingReleaser()
    const first = await runAccountClosureSweep(admin, { now, releaser })
    const second = await runAccountClosureSweep(admin, { now, releaser })
    expect(first.reminders).toBe(1)
    expect(first.deleted).toBe(0)
    expect(second.reminders).toBe(0)
    expect(calls).toEqual([])
    const deliveries = readSystemEmailTestDeliveries().filter((message) => message.to === INBOX)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].replyTo).toBe('support@styleflo.ai')
    expect(deliveries[0].text).toContain('no StyleFlo number to release')
    const { data: logs } = await admin.from('system_email_log').select('idempotency_key').eq('tenant_id', TENANT)
    expect(logs).toHaveLength(1)

    const reopened = await reopenAccountClosure(admin, TENANT, now)
    expect(reopened.ok && reopened.skipped === null).toBe(true)
    const later = await runAccountClosureSweep(admin, { now: addClosureDays(now, 31), releaser })
    expect(later.deleted).toBe(0)
    expect(later.reminders).toBe(0)
    expect(calls).toEqual([])
    await cleanup(admin)
  })

  test('deletion day deletes data once and releases a held number once', async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required')
    const admin = adminClient()
    await ensureTenant(admin, { shadow: '+441632960123', mobile: '+441632960123' })
    await cleanup(admin)
    await ensureTenant(admin, { shadow: '+441632960123', mobile: '+441632960123' })
    const { error: purchaseError } = await admin.from('tenant_phone_number_purchases').insert({
      tenant_id: TENANT,
      status: 'active',
      phone_number: '+441632960123',
    })
    expect(purchaseError).toBeNull()
    const { error: serviceError } = await admin.from('services').insert({
      tenant_id: TENANT,
      name: 'Cut and finish',
    })
    expect(serviceError).toBeNull()

    const now = new Date('2026-08-01T00:00:00.000Z')
    const opened = await openAccountClosure(admin, {
      tenantId: TENANT,
      reason: 'failed_payment',
      closedAt: addClosureDays(now, -31).toISOString(),
      sourceKey: 'failed-payment:test-275-delete',
    })
    expect(opened.ok && opened.skipped === null && opened.row.number_state).toBe('held')
    const { data: held } = await admin.from('tenant_phone_number_purchases').select('status').eq('tenant_id', TENANT).maybeSingle()
    expect(held?.status).toBe('held')

    const { releaser, calls } = countingReleaser()
    const first = await runAccountClosureSweep(admin, { now, releaser })
    const second = await runAccountClosureSweep(admin, { now, releaser })
    expect(first.deleted).toBe(1)
    expect(first.released).toBe(1)
    expect(first.confirmations).toBe(1)
    expect(first.reminders).toBe(1)
    expect(second.deleted).toBe(0)
    expect(second.released).toBe(0)
    expect(second.confirmations).toBe(0)
    expect(second.reminders).toBe(0)
    expect(calls).toEqual(['twilio:+441632960123', 'vapi:+441632960123'])
    const { data: services } = await admin.from('services').select('id').eq('tenant_id', TENANT)
    expect(services).toEqual([])
    const { data: tenant } = await admin.from('tenants').select('twilio_shadow_number, twilio_mobile_number').eq('id', TENANT).single()
    expect(tenant?.twilio_shadow_number).toBeNull()
    expect(tenant?.twilio_mobile_number).toBeNull()
    const { data: purchase } = await admin.from('tenant_phone_number_purchases').select('tenant_id').eq('tenant_id', TENANT)
    expect(purchase).toEqual([])
    const confirmation = readSystemEmailTestDeliveries().find((message) => message.subject.includes('has been deleted'))
    expect(confirmation?.text).toContain('released the StyleFlo number +441632960123')
    expect(confirmation?.replyTo).toBe('support@styleflo.ai')
    const { data: logs } = await admin.from('system_email_log').select('idempotency_key').eq('tenant_id', TENANT)
    expect(logs).toHaveLength(2)
    await cleanup(admin)
  })

  test('the daily route sends a due reminder once and makes no vendor calls', async () => {
    if (!serviceKey) throw new Error('Local Supabase service role key is required')
    const admin = adminClient()
    await ensureTenant(admin, {})
    await cleanup(admin)
    await ensureTenant(admin, {})
    const closedAt = new Date(Date.now() - 24 * DAY - 60_000).toISOString()
    const opened = await openAccountClosure(admin, {
      tenantId: TENANT,
      reason: 'trial_ended',
      closedAt,
      sourceKey: 'trial:test-275-route',
    })
    expect(opened.ok && opened.skipped === null).toBe(true)

    const gateway: FailedPaymentStripeGateway = {
      subscriptions: {
        async retrieve() {
          return { items: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] } }
        },
        async update() { return {} },
        async cancel() { return {} },
      },
      invoices: {
        async markUncollectible() { return {} },
        async create() { return {} },
      },
    }
    setFailedPaymentStripeClientForTests(createFailedPaymentStripeClient(gateway))
    process.env.FAILED_PAYMENT_SWEEP_SECRET = 'sweep-secret-275'
    const headers = { authorization: 'Bearer sweep-secret-275' }
    const first = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', { method: 'POST', headers }))
    const second = await sweepPost(new Request('http://localhost:3001/api/billing/failed-payment-sweep', { method: 'POST', headers }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody.closure.reminders).toBe(1)
    expect(firstBody.closure.deleted).toBe(0)
    expect(secondBody.closure.reminders).toBe(0)
    expect(telephonyReleaseCallLog.twilio).toBe(0)
    expect(telephonyReleaseCallLog.vapi).toBe(0)
    setFailedPaymentStripeClientForTests(null)
    await cleanup(admin)
  })

  test('vendor release stays inside the Playwright mock', async () => {
    telephonyReleaseCallLog.reset()
    await releaseTwilioNumber('+441632960999')
    await releaseVapiNumber('+441632960999')
    expect(telephonyReleaseCallLog.twilio).toBe(1)
    expect(telephonyReleaseCallLog.vapi).toBe(1)
  })
})
