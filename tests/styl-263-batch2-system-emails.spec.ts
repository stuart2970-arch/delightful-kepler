import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { listSystemEmailTemplates } from '../src/lib/email/system/registry'
import { resendSystemEmail } from '../src/lib/email/system/log'
import {
  readSystemEmailTestDeliveries,
  resetSystemEmailTestState,
  wasMailgunClientCreated,
} from '../src/lib/email/system/deliver'
import { batch2Templates } from '../src/lib/email/system/templates/batch-2'
import {
  BATCH2_ACCOUNT_CLOSED,
  BATCH2_ANNUAL_PRICE_RISE,
  BATCH2_BOLT_ON_ADDED,
  BATCH2_OTHER_PRICE_RISE,
  BATCH2_SIGNUP_DECLINED,
  annualPriceRiseDashboardNotice,
  otherPriceRiseDashboardNotice,
} from '../src/lib/email/system/templates/batch-2'
import { isBatch2SystemEmailEnabled } from '../src/lib/email/system/triggers/batch2/flag'
import { declineSignup, closeAccountNotABusiness } from '../src/lib/email/system/triggers/batch2/decline-and-close'
import {
  annualPriceCapPercent,
  priceAfterCapPence,
  startedAtLeastTwelveMonthsBefore,
} from '../src/lib/email/system/triggers/batch2/price-rules'
import { sendAnnualPriceRiseNotice, sendOtherPriceRiseNotice } from '../src/lib/email/system/triggers/batch2/price-rise'
import {
  boltOnAddsFromStripeEvent,
  notifyBoltOnAdded,
} from '../src/lib/email/system/triggers/batch2/bolt-on-added'
import { createTestNormalUser, createTestSuperadminUser, type TestUserSession } from './test-auth-helper'

/**
 * STYL-263 batch 2 and STYL-278 bolt-on added.
 * Local Supabase only. Mailgun stays mocked. Live sending stays behind
 * SYSTEM_EMAILS_BATCH2_ENABLED, which defaults off.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const INBOX = 'test999@styleflo.ai'
const root = process.cwd()
const ACME = '10000000-0000-0000-0000-000000000001'

process.env.PLAYWRIGHT_TEST = 'true'

function service(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function localSupabase(): void {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').toLowerCase()
  expect(url.includes('127.0.0.1') || url.includes('localhost')).toBe(true)
  expect(url.includes('tkoasyjvrgaglofpzduq')).toBe(false)
}

async function ownInbox(tenantId: string): Promise<string> {
  const admin = service()
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
  const { error } = await admin.from('profiles').upsert({
    id: userId,
    tenant_id: tenantId,
    role: 'owner',
    is_super_admin: false,
  })
  expect(error).toBeNull()
  return userId
}

test.describe('STYL-263 batch 2 templates', () => {
  test('production registry includes every batch 2 template once', () => {
    const keys = listSystemEmailTemplates({ APP_ENV: 'production', PLAYWRIGHT_TEST: '' } as NodeJS.ProcessEnv)
      .map((template) => template.key)
    const batch2 = batch2Templates.map((template) => template.key)
    expect(batch2).toHaveLength(13)
    for (const key of batch2) {
      expect(keys.filter((item) => item === key)).toHaveLength(1)
    }
  })

  test('sample previews state the Terms facts and do not add promises', () => {
    const previews = readFileSync(join(root, 'docs/system-emails/batch-2-previews.md'), 'utf8')
    for (const template of batch2Templates) {
      const rendered = template.render({ ...template.sampleData })
      expect(rendered.subject.trim().length).toBeGreaterThan(0)
      expect(rendered.text.trim().length).toBeGreaterThan(0)
      expect(rendered.html).toContain('StyleFlo')
      expect(rendered.text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(rendered.text.toLowerCase()).not.toContain('unsubscribe')
      expect(rendered.text.toLowerCase()).not.toContain('free of charge')
      expect(rendered.text.toLowerCase()).not.toContain('we have refunded')
      expect(rendered.text.toLowerCase()).not.toContain('billing has stopped')
      expect(previews).toContain(`## ${template.key}`)
      expect(previews).toContain(rendered.subject)
      expect(previews).toContain(rendered.text)
    }

    const declined = batch2Templates.find((template) => template.key === BATCH2_SIGNUP_DECLINED)!
    expect(declined.render(declined.sampleData).text).toContain('We have started a refund of everything you have paid (£9.99).')
    expect(declined.render(declined.sampleData).text).toContain('re_batch2_decline')
    expect(declined.render(declined.sampleData).text).toContain("We can't verify your business.")
    const bareDecline = declined.render({
      businessName: 'Harbour Salon',
      reasonCode: 'business_unverified',
      amountPaidPence: '999',
    })
    expect(bareDecline.text.toLowerCase()).not.toContain('refund')

    const closed = batch2Templates.find((template) => template.key === BATCH2_ACCOUNT_CLOSED)!
    expect(closed.render(closed.sampleData).text).toContain('not being used for a business')
    expect(closed.render(closed.sampleData).text).toContain('30 days')
    expect(closed.render(closed.sampleData).text).toContain('re_batch2_close')
    const bareClose = closed.render({
      businessName: 'Harbour Salon',
      unusedPeriodPence: '499',
      unusedPeriodEnds: '2027-04-01',
    })
    expect(bareClose.text).not.toContain('We have closed')
    expect(bareClose.text).not.toContain('30 days')
    expect(bareClose.text.toLowerCase()).not.toContain('refund')

    const annual = batch2Templates.find((template) => template.key === BATCH2_ANNUAL_PRICE_RISE)!
    const annualText = annual.render(annual.sampleData).text
    expect(annualText).toContain('1 April 2027')
    expect(annualText).toContain('£9.99 to £10.51')
    expect(annualText).toContain('60 days')
    expect(annualText.toLowerCase()).not.toContain('dashboard')
    const notice = annualPriceRiseDashboardNotice(annual.sampleData)
    expect(annualText.startsWith(notice)).toBe(true)
    expect(notice).not.toContain('Reply to this email')

    const other = batch2Templates.find((template) => template.key === BATCH2_OTHER_PRICE_RISE)!
    const otherText = other.render(other.sampleData).text
    expect(otherText.startsWith(otherPriceRiseDashboardNotice(other.sampleData))).toBe(true)
    expect(otherText.toLowerCase()).not.toContain('dashboard')

    const escaped = declined.render({ ...declined.sampleData, businessName: '<b>Harbour</b>' })
    expect(escaped.html).toContain('&lt;b&gt;Harbour&lt;/b&gt;')
    expect(escaped.html).not.toContain('<b>Harbour</b>')
  })

  test('the annual cap and the notice windows follow the Terms', () => {
    expect(annualPriceCapPercent(3.2)).toBe(5.2)
    expect(annualPriceCapPercent(9)).toBe(8)
    expect(annualPriceCapPercent(-3)).toBe(0)
    expect(priceAfterCapPence(999, 5.2)).toBe(1051)
    expect(priceAfterCapPence(499, 5.2)).toBe(525)
    expect(startedAtLeastTwelveMonthsBefore('2026-04-01', '2027-04-01')).toBe(true)
    expect(startedAtLeastTwelveMonthsBefore('2026-04-02', '2027-04-01')).toBe(false)
    expect(isBatch2SystemEmailEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(isBatch2SystemEmailEnabled({ SYSTEM_EMAILS_BATCH2_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isBatch2SystemEmailEnabled({ SYSTEM_EMAILS_BATCH2_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
  })
})

test.describe('STYL-263 batch 2 triggers', () => {
  let tenantId = ''
  let userId = ''
  const previousFlag = process.env.SYSTEM_EMAILS_BATCH2_ENABLED

  test.beforeAll(async () => {
    localSupabase()
    const admin = service()
    tenantId = crypto.randomUUID()
    const { error } = await admin.from('tenants').insert({
      id: tenantId,
      company_name: 'Harbour Salon',
      slug: `harbour-batch2-${tenantId.slice(0, 8)}`,
      plan_tier: 'foundation',
    })
    expect(error).toBeNull()
    userId = await ownInbox(tenantId)
  })

  test.afterAll(async () => {
    const admin = service()
    if (tenantId) {
      await admin.from('system_email_log').delete().eq('tenant_id', tenantId)
      await admin.from('profiles').delete().eq('id', userId)
      await admin.from('tenants').delete().eq('id', tenantId)
    }
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  test.beforeEach(() => {
    process.env.PLAYWRIGHT_TEST = 'true'
    delete process.env.SYSTEM_EMAILS_BATCH2_ENABLED
    resetSystemEmailTestState()
  })

  test.afterEach(() => {
    if (previousFlag === undefined) delete process.env.SYSTEM_EMAILS_BATCH2_ENABLED
    else process.env.SYSTEM_EMAILS_BATCH2_ENABLED = previousFlag
  })

  test('the flag stops a decline email, and one admin action sends it once', async () => {
    const missing = await declineSignup({
      tenantId,
      reasonCode: 'number_unavailable',
      amountPaidPence: 999,
    })
    expect(missing.ok).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)

    const held = await declineSignup({
      tenantId,
      reasonCode: 'number_unavailable',
      amountPaidPence: 999,
      refundRecorded: true,
      refundReference: 're_batch2_decline',
    })
    expect(held.ok).toBe(true)
    if (!held.ok) return
    expect(held.refund).toBe('recorded')
    expect(held.email).toEqual({ ok: true, skipped: true, reason: 'disabled' })
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    expect(wasMailgunClientCreated()).toBe(false)

    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const first = await declineSignup({
      tenantId,
      reasonCode: 'number_unavailable',
      amountPaidPence: 999,
      refundRecorded: true,
      refundReference: 're_batch2_decline',
    })
    const second = await declineSignup({
      tenantId,
      reasonCode: 'pricing_mistake',
      amountPaidPence: 999,
      refundRecorded: true,
      refundReference: 're_batch2_decline',
    })
    expect(first.ok && first.email.ok && !first.email.skipped && first.email.duplicate).toBe(false)
    expect(second.ok && second.email.ok && !second.email.skipped && second.email.duplicate).toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(1)
    expect(readSystemEmailTestDeliveries()[0]?.to).toBe(INBOX)
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain("Our telecoms provider can't supply a number you have chosen.")
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain('We have started a refund')
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain('re_batch2_decline')
    expect(wasMailgunClientCreated()).toBe(false)

    if (!first.ok || !first.email.ok || first.email.skipped) return
    const resent = await resendSystemEmail({
      logId: first.email.logId,
      idempotencyKey: `batch2-resend-${crypto.randomUUID()}`,
    })
    expect(resent.ok).toBe(true)
    if (!resent.ok) return
    expect(resent.duplicate).toBe(false)
    expect(readSystemEmailTestDeliveries()).toHaveLength(2)

    const admin = service()
    const { data: rows } = await admin
      .from('system_email_log')
      .select('template_key, recipient, status')
      .eq('tenant_id', tenantId)
      .eq('template_key', BATCH2_SIGNUP_DECLINED)
    expect(rows?.length).toBeGreaterThanOrEqual(1)
    expect(rows?.every((row) => row.recipient === INBOX && row.status === 'sent')).toBe(true)
  })

  test('closing an account that is not a business emails once and does not refund a card', async () => {
    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const unrecorded = await closeAccountNotABusiness({
      tenantId,
      unusedPeriodPence: 499,
      unusedPeriodEnds: '2027-04-01',
    })
    expect(unrecorded.ok).toBe(false)

    const closed = await closeAccountNotABusiness({
      tenantId,
      accountClosed: true,
      unusedPeriodPence: 499,
      unusedPeriodEnds: '2027-04-01',
      refundRecorded: true,
      refundReference: 're_batch2_close',
    })
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.refund).toBe('recorded')
    expect(closed.email.ok && !closed.email.skipped).toBe(true)
    const again = await closeAccountNotABusiness({
      tenantId,
      accountClosed: true,
      unusedPeriodPence: 100,
      refundRecorded: true,
      refundReference: 're_batch2_close',
    })
    expect(again.ok && again.email.ok && !again.email.skipped && again.email.duplicate).toBe(true)
    const delivery = readSystemEmailTestDeliveries().find((message) => message.text.includes('not being used for a business'))
    expect(delivery?.text).toContain('£4.99')
    expect(delivery?.text).toContain('1 April 2027')
    expect(delivery?.text).toContain('We have started a refund')
    expect(delivery?.text).toContain('30 days')

    const admin = service()
    const { data } = await admin.from('system_email_log').select('template_key').eq('tenant_id', tenantId).eq('template_key', BATCH2_ACCOUNT_CLOSED)
    expect(data).toHaveLength(1)
  })

  test('annual and other price notices keep the 60-day and 12-month rules', async () => {
    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const tooSoon = await sendAnnualPriceRiseNotice({
      tenantId,
      subscriptionStartedOn: '2025-04-01',
      effectiveDate: '2027-04-01',
      noticeDate: '2027-02-15',
      cpi12MonthPercent: 3.2,
      prices: [{ label: 'Foundation', currentPence: 999 }],
    })
    expect(tooSoon.ok).toBe(false)

    const firstYear = await sendAnnualPriceRiseNotice({
      tenantId,
      subscriptionStartedOn: '2026-06-01',
      effectiveDate: '2027-04-01',
      noticeDate: '2027-01-15',
      cpi12MonthPercent: 3.2,
      prices: [{ label: 'Foundation', currentPence: 999 }],
    })
    expect(firstYear.ok).toBe(false)

    const annual = await sendAnnualPriceRiseNotice({
      tenantId,
      subscriptionStartedOn: '2025-04-01',
      effectiveDate: '2027-04-01',
      noticeDate: '2027-01-15',
      cpi12MonthPercent: 3.2,
      prices: [{ label: 'Foundation', currentPence: 999 }, { label: 'Google Calendar', currentPence: 499 }],
    })
    expect(annual.ok).toBe(true)
    if (!annual.ok) return
    expect(annual.dashboardNotice).toContain('£9.99 to £10.51')
    expect(annual.dashboardNotice).toContain('£4.99 to £5.25')
    expect(annual.dashboardNotice).not.toContain('Reply to this email')
    const repeat = await sendAnnualPriceRiseNotice({
      tenantId,
      subscriptionStartedOn: '2025-04-01',
      effectiveDate: '2027-04-01',
      noticeDate: '2027-01-15',
      cpi12MonthPercent: 3.2,
      prices: [{ label: 'Foundation', currentPence: 999 }],
    })
    expect(repeat.ok && repeat.email.ok && !repeat.email.skipped && repeat.email.duplicate).toBe(true)

    const other = await sendOtherPriceRiseNotice({
      tenantId,
      effectiveDate: '2027-06-01',
      noticeDate: '2027-03-01',
      howWorkedOut: 'The monthly Foundation price is increasing by £1.00.',
      prices: [{ label: 'Foundation', currentPence: 999, newPence: 1099 }],
    })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(other.dashboardNotice).toContain('£9.99 to £10.99')
    expect(other.dashboardNotice).toContain('at least 60 days')

    const admin = service()
    const { data } = await admin.from('system_email_log').select('template_key').eq('tenant_id', tenantId).in('template_key', [BATCH2_ANNUAL_PRICE_RISE, BATCH2_OTHER_PRICE_RISE])
    expect(data?.map((row) => row.template_key).sort()).toEqual([BATCH2_ANNUAL_PRICE_RISE, BATCH2_OTHER_PRICE_RISE])
  })

  test('a bolt-on checkout emails once, and a pack does not', async () => {
    const checkout = {
      id: 'evt_batch2_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_batch2_calendar',
          subscription: 'sub_batch2_calendar',
          metadata: {
            tenant_id: tenantId,
            addon_catalog_id: 'google_calendar_addon',
            is_addon: 'true',
            is_one_off: 'false',
            price_pence: '499',
          },
        },
      },
    }
    const pack = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_batch2_pack',
          metadata: {
            tenant_id: tenantId,
            addon_catalog_id: 'voice_pack_20',
            is_addon: 'true',
            is_one_off: 'true',
          },
        },
      },
    }
    expect(boltOnAddsFromStripeEvent(checkout)).toHaveLength(1)
    expect(boltOnAddsFromStripeEvent(pack)).toHaveLength(0)
    expect(boltOnAddsFromStripeEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_batch2_calendar',
          status: 'active',
          metadata: checkout.data.object.metadata,
        },
      },
    })[0]?.activationId).toBe('sub_batch2_calendar')

    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const first = await notifyBoltOnAdded(boltOnAddsFromStripeEvent(checkout)[0])
    const second = await notifyBoltOnAdded({
      tenantId,
      addonCatalogId: 'google_calendar_addon',
      activationId: 'sub_batch2_calendar',
    })
    expect(first.ok && first.email.ok && !first.email.skipped && first.email.duplicate).toBe(false)
    expect(second.ok && second.email.ok && !second.email.skipped && second.email.duplicate).toBe(true)
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain('Google Calendar')
    expect(readSystemEmailTestDeliveries()[0]?.text).toContain('£4.99')

    const skippedPack = await notifyBoltOnAdded({
      tenantId,
      addonCatalogId: 'voice_pack_20',
      activationId: 'cs_batch2_pack',
    })
    expect(skippedPack.ok).toBe(false)

    const admin = service()
    const { data } = await admin.from('system_email_log').select('template_key').eq('tenant_id', tenantId).eq('template_key', BATCH2_BOLT_ON_ADDED)
    expect(data).toHaveLength(1)
  })
})

test.describe('STYL-263 batch 2 admin routes', () => {
  let superadmin: TestUserSession
  let normalUser: TestUserSession

  test.beforeAll(async () => {
    localSupabase()
    superadmin = await createTestSuperadminUser()
    normalUser = await createTestNormalUser()
  })

  test.afterAll(async () => {
    if (superadmin) await superadmin.cleanup()
    if (normalUser) await normalUser.cleanup()
  })

  test('decline, close and price notices are superadmin only and do not send while the flag is off', async ({ request }) => {
    const body = {
      action: 'decline-signup',
      tenantId: ACME,
      reasonCode: 'business_unverified',
      amountPaidPence: 999,
      refundRecorded: true,
      refundReference: 're_batch2_decline',
    }
    const unauth = await request.post('/api/superadmin/account-actions', { data: body })
    expect(unauth.status()).toBe(401)
    const forbidden = await request.post('/api/superadmin/account-actions', {
      headers: { Authorization: `Bearer ${normalUser.token}` },
      data: body,
    })
    expect(forbidden.status()).toBe(403)

    const declined = await request.post('/api/superadmin/account-actions', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: body,
    })
    expect(declined.status()).toBe(200)
    const declinedBody = await declined.json()
    expect(declinedBody.refund).toBe('recorded')
    const unrecorded = await request.post('/api/superadmin/account-actions', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: { action: 'decline-signup', tenantId: ACME, reasonCode: 'business_unverified', amountPaidPence: 999 },
    })
    expect(unrecorded.status()).toBe(400)
    expect(declinedBody.email).toEqual({ ok: true, skipped: true, reason: 'disabled' })

    const closed = await request.post('/api/superadmin/account-actions', {
      headers: { Authorization: `Bearer ${superadmin.token}` },
      data: {
        action: 'close-not-a-business',
        tenantId: ACME,
        accountClosed: true,
        unusedPeriodPence: 100,
        unusedPeriodEnds: '2027-04-01',
        refundRecorded: true,
        refundReference: 're_batch2_close',
      },
    })
    expect(closed.status()).toBe(200)
    expect((await closed.json()).email.reason).toBe('disabled')

    const annual = await request.post('/api/superadmin/account-actions', {
      headers: { Authorization: `Bearer ${normalUser.token}` },
      data: {
        action: 'annual-price-rise',
        tenantId: ACME,
        subscriptionStartedOn: '2025-04-01',
        effectiveDate: '2027-04-01',
        noticeDate: '2027-01-15',
        cpi12MonthPercent: 3.2,
        prices: [{ label: 'Foundation', currentPence: 999 }],
      },
    })
    expect(annual.status()).toBe(403)

    const other = await request.post('/api/superadmin/account-actions', {
      data: { action: 'other-price-rise', tenantId: ACME },
    })
    expect(other.status()).toBe(401)

    const route = readFileSync(join(root, 'src/app/api/webhooks/stripe/route.ts'), 'utf8')
    expect(route).toContain('notifyBoltOnsAddedFromStripeEvent')
    const declineSource = readFileSync(join(root, 'src/lib/email/system/triggers/batch2/decline-and-close.ts'), 'utf8')
    expect(declineSource).not.toContain('stripe')
  })
})
