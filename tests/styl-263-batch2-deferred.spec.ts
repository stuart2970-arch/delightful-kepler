import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { listSystemEmailTemplates } from '../src/lib/email/system/registry'
import {
  readSystemEmailTestDeliveries,
  resetSystemEmailTestState,
  wasMailgunClientCreated,
} from '../src/lib/email/system/deliver'
import { batch2Templates } from '../src/lib/email/system/templates/batch-2'
import {
  BATCH2_AUTO_TOPUP_LIMIT,
  BATCH2_AUTO_TOPUP_PAYMENT,
  BATCH2_AUTO_TOPUP_RECEIPT,
  BATCH2_PACK_PRICE_CHANGE,
  BATCH2_PORTING_RECEIVED,
} from '../src/lib/email/system/templates/batch-2'
import { isBatch2SystemEmailEnabled } from '../src/lib/email/system/triggers/batch2/flag'
import {
  sendAutoTopupLimitReached,
  sendAutoTopupPaymentNeedsAction,
  sendAutoTopupReceipt,
  sendPackPriceChangeNotice,
  sendPortingConfirmation,
} from '../src/lib/email/system/triggers/batch2/deferred'

/**
 * STYL-263 batch 2 package 4b. Auto top-up and porting templates.
 * Local Supabase only. Mailgun stays mocked. Live sending stays off.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const INBOX = 'test999@styleflo.ai'
const root = process.cwd()

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
  expect(url.includes('lriugykhrfnnouexqqhm')).toBe(false)
}

test.describe('STYL-263 batch 2 deferred templates', () => {
  test('production registry includes the deferred templates once', () => {
    const keys = listSystemEmailTemplates({ APP_ENV: 'production', PLAYWRIGHT_TEST: '' } as NodeJS.ProcessEnv)
      .map((template) => template.key)
    const batch2 = batch2Templates.map((template) => template.key)
    expect(batch2).toHaveLength(13)
    for (const key of batch2) {
      expect(keys.filter((item) => item === key)).toHaveLength(1)
    }
    expect(isBatch2SystemEmailEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(isBatch2SystemEmailEnabled({ SYSTEM_EMAILS_BATCH2_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
  })

  test('sample previews state the Terms facts and do not add promises', () => {
    const previews = readFileSync(join(root, 'docs/system-emails/batch-2-previews.md'), 'utf8')
    for (const template of batch2Templates) {
      const rendered = template.render({ ...template.sampleData })
      expect(rendered.text).toContain('Reply to this email and it will reach StyleFlo support.')
      expect(rendered.text.toLowerCase()).not.toContain('unsubscribe')
      expect(rendered.text.toLowerCase()).not.toContain('free of charge')
      expect(rendered.text.toLowerCase()).not.toContain('billing has stopped')
      expect(previews).toContain(`## ${template.key}`)
      expect(previews).toContain(rendered.subject)
      expect(previews).toContain(rendered.text)
    }
    const receipt = batch2Templates.find((template) => template.key === BATCH2_AUTO_TOPUP_RECEIPT)!
    const receiptText = receipt.render(receipt.sampleData).text
    expect(receiptText).toContain('£14.99')
    expect(receiptText).toContain('3 months')
    expect(receiptText).toContain('not refundable')
    const port = batch2Templates.find((template) => template.key === BATCH2_PORTING_RECEIVED)!
    expect(port.render(port.sampleData).text).toContain('01632 960123')
  })
})

test.describe('STYL-263 batch 2 deferred sends', () => {
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
      slug: `harbour-batch2b-${tenantId.slice(0, 8)}`,
      plan_tier: 'foundation',
    })
    expect(error).toBeNull()
    const created = await admin.auth.admin.createUser({
      email: INBOX,
      password: 'Password123!',
      email_confirm: true,
    })
    userId = created.data.user?.id || ''
    if (!userId) {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      userId = listed.data.users.find((user) => user.email?.toLowerCase() === INBOX)?.id || ''
    }
    expect(userId).toBeTruthy()
    const profile = await admin.from('profiles').upsert({
      id: userId,
      tenant_id: tenantId,
      role: 'owner',
      is_super_admin: false,
    })
    expect(profile.error).toBeNull()
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

  test('the flag stops a receipt, and one charge sends it once', async () => {
    const held = await sendAutoTopupReceipt({
      tenantId,
      chargeId: 'ch_batch2_receipt',
      purchasedOn: '2027-03-02',
      packName: '30 voice minutes',
      amountPence: 1499,
    })
    expect(held.ok && held.email.ok && held.email.skipped && held.email.reason === 'disabled').toBe(true)
    expect(readSystemEmailTestDeliveries()).toHaveLength(0)
    expect(wasMailgunClientCreated()).toBe(false)

    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const receipt = await sendAutoTopupReceipt({
      tenantId,
      chargeId: 'ch_batch2_receipt',
      purchasedOn: '2027-03-02',
      packName: '30 voice minutes',
      amountPence: 1499,
    })
    const again = await sendAutoTopupReceipt({
      tenantId,
      chargeId: 'ch_batch2_receipt',
      purchasedOn: '2027-03-02',
      packName: '30 voice minutes',
      amountPence: 1499,
    })
    expect(receipt.ok && receipt.email.ok && !receipt.email.skipped && receipt.email.duplicate).toBe(false)
    expect(again.ok && again.email.ok && !again.email.skipped && again.email.duplicate).toBe(true)
    expect(readSystemEmailTestDeliveries()[0]?.to).toBe(INBOX)
    expect(wasMailgunClientCreated()).toBe(false)
  })

  test('a late pack-price notice is refused, and limit, payment and port notices send once', async () => {
    process.env.SYSTEM_EMAILS_BATCH2_ENABLED = 'true'
    const late = await sendPackPriceChangeNotice({
      tenantId,
      packId: 'voice-30',
      packName: '30 voice minutes',
      currentPricePence: 1499,
      newPricePence: 1599,
      firstBuyDate: '2027-04-01',
      noticeDate: '2027-03-20',
    })
    expect(late.ok).toBe(false)

    const limit = await sendAutoTopupLimitReached({
      tenantId,
      billingMonth: '2027-03',
      limitDescription: 'the monthly limit set on the account',
      nextBillingDate: '2027-04-02',
    })
    const payment = await sendAutoTopupPaymentNeedsAction({
      tenantId,
      paymentId: 'pi_batch2_confirm',
      paymentState: 'needs_confirmation',
      packName: '30 voice minutes',
      amountPence: 1499,
    })
    const port = await sendPortingConfirmation({
      tenantId,
      status: 'received',
      requestId: 'port_batch2',
      numberKind: 'mobile',
      phoneNumber: '07700 900123',
    })
    expect(limit.ok && payment.ok && port.ok).toBe(true)
    expect(readSystemEmailTestDeliveries().some((message) => message.text.includes('07700 900123'))).toBe(true)
    expect(readSystemEmailTestDeliveries().some((message) => message.text.includes('does not pause the account'))).toBe(true)

    const admin = service()
    const { data } = await admin
      .from('system_email_log')
      .select('template_key')
      .eq('tenant_id', tenantId)
      .in('template_key', [
        BATCH2_AUTO_TOPUP_RECEIPT,
        BATCH2_AUTO_TOPUP_LIMIT,
        BATCH2_AUTO_TOPUP_PAYMENT,
        BATCH2_PORTING_RECEIVED,
        BATCH2_PACK_PRICE_CHANGE,
      ])
    expect(data?.map((row) => row.template_key).sort()).toEqual([
      BATCH2_AUTO_TOPUP_LIMIT,
      BATCH2_AUTO_TOPUP_PAYMENT,
      BATCH2_AUTO_TOPUP_RECEIPT,
      BATCH2_PORTING_RECEIVED,
    ])
  })
})
