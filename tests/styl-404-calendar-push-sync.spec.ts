import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import {
  renewCalendarPushSubscriptions,
  mockRenewSubscriptionRow,
} from '../src/lib/calendar/push-sync/renew-subscriptions'
import { listSubscriptionsExpiringBefore } from '../src/lib/calendar/push-sync/subscription-store'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const SLOT_START = '2026-11-23T10:00:00.000Z'
const SLOT_END = '2026-11-23T10:30:00.000Z'
const MOVED_START = '2026-11-23T11:00:00.000Z'
const MOVED_END = '2026-11-23T11:30:00.000Z'

test.describe('STYL-404 calendar push sync', () => {
  let tenantId = ''
  let staffId = ''
  let googleApptId = ''
  let msApptId = ''
  const googleEventId = `g-evt-${randomUUID()}`
  const msEventId = `ms-evt-${randomUUID()}`
  const googleChannelId = randomUUID()
  const googleToken = randomUUID()
  const msSubscriptionId = randomUUID()
  const msClientState = randomUUID()

  test.beforeAll(async () => {
    const admin = adminClient()
    const suffix = `styl404-${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ company_name: `STYL-404 ${suffix}`, slug: `styl404-${suffix}` })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    tenantId = tenant!.id

    const { data: staff, error: staffErr } = await admin
      .from('staff')
      .insert({
        tenant_id: tenantId,
        name: 'Sam',
        email: `${suffix}@example.com`,
        calendar_provider: 'google',
        google_calendar_id: 'primary',
      })
      .select('id')
      .single()
    expect(staffErr).toBeNull()
    staffId = staff!.id

    const { data: service, error: svcErr } = await admin
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: 'Consultation',
        duration_minutes: 30,
        price: 20,
      })
      .select('id')
      .single()
    expect(svcErr).toBeNull()

    const { data: gAppt, error: gErr } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: service!.id,
        customer_name: 'Google Customer',
        customer_email: 'g@example.com',
        start_time: SLOT_START,
        end_time: SLOT_END,
        google_event_id: googleEventId,
        status: 'booked',
      })
      .select('id')
      .single()
    expect(gErr).toBeNull()
    googleApptId = gAppt!.id

    const { data: mAppt, error: mErr } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: service!.id,
        customer_name: 'Microsoft Customer',
        customer_email: 'm@example.com',
        start_time: SLOT_START,
        end_time: SLOT_END,
        microsoft_event_id: msEventId,
        status: 'booked',
      })
      .select('id')
      .single()
    expect(mErr).toBeNull()
    msApptId = mAppt!.id

    const expires = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
    await admin.from('calendar_push_subscriptions').insert([
      {
        tenant_id: tenantId,
        provider: 'google',
        calendar_id: 'primary',
        channel_id: googleChannelId,
        resource_id: 'res-google-1',
        verification_token: googleToken,
        expires_at: expires,
      },
      {
        tenant_id: tenantId,
        provider: 'microsoft',
        calendar_id: 'me/events',
        channel_id: msSubscriptionId,
        resource_id: null,
        verification_token: msClientState,
        expires_at: expires,
      },
    ])
  })

  test('Google webhook rejects invalid channel token', async ({ request }) => {
    const res = await request.post('/api/webhooks/calendar/google', {
      headers: {
        'x-goog-channel-id': googleChannelId,
        'x-goog-channel-token': 'wrong-token',
        'x-goog-resource-state': 'exists',
      },
    })
    expect(res.status()).toBe(403)
  })

  test('Google webhook mock payload cancels and moves appointments', async ({ request }) => {
    const cancelRes = await request.post('/api/webhooks/calendar/google', {
      headers: {
        'x-goog-channel-id': googleChannelId,
        'x-goog-channel-token': googleToken,
        'x-goog-resource-state': 'exists',
        'Content-Type': 'application/json',
      },
      data: {
        mockEventPayloads: [{ eventId: googleEventId, state: { kind: 'cancelled' } }],
      },
    })
    expect(cancelRes.status()).toBe(200)
    const admin = adminClient()
    const { data: cancelled } = await admin.from('appointments').select('status').eq('id', googleApptId).single()
    expect(cancelled?.status).toBe('cancelled')

    await admin
      .from('appointments')
      .update({ status: 'booked', start_time: SLOT_START, end_time: SLOT_END })
      .eq('id', googleApptId)

    const moveRes = await request.post('/api/webhooks/calendar/google', {
      headers: {
        'x-goog-channel-id': googleChannelId,
        'x-goog-channel-token': googleToken,
        'x-goog-resource-state': 'exists',
        'Content-Type': 'application/json',
      },
      data: {
        mockEventPayloads: [{
          eventId: googleEventId,
          state: { kind: 'active', startIso: MOVED_START, endIso: MOVED_END },
        }],
      },
    })
    expect(moveRes.status()).toBe(200)
    const { data: moved } = await admin
      .from('appointments')
      .select('start_time, end_time, status')
      .eq('id', googleApptId)
      .single()
    expect(moved?.status).toBe('booked')
    expect(new Date(moved!.start_time).toISOString()).toBe(MOVED_START)
    expect(new Date(moved!.end_time).toISOString()).toBe(MOVED_END)
  })

  test('Microsoft validation-token handshake returns plain text', async ({ request }) => {
    const token = `validation-${randomUUID()}`
    const res = await request.get(`/api/webhooks/calendar/microsoft?validationToken=${encodeURIComponent(token)}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type'] || '').toContain('text/plain')
    await expect(res.text()).resolves.toBe(token)
  })

  test('Microsoft webhook handles delete and mocked move', async ({ request }) => {
    const deleteRes = await request.post('/api/webhooks/calendar/microsoft', {
      data: {
        value: [{
          subscriptionId: msSubscriptionId,
          clientState: msClientState,
          changeType: 'deleted',
          resourceData: { id: msEventId },
        }],
      },
    })
    expect(deleteRes.status()).toBe(200)
    const admin = adminClient()
    const { data: cancelled } = await admin.from('appointments').select('status').eq('id', msApptId).single()
    expect(cancelled?.status).toBe('cancelled')

    await admin
      .from('appointments')
      .update({ status: 'booked', start_time: SLOT_START, end_time: SLOT_END })
      .eq('id', msApptId)

    const moveRes = await request.post('/api/webhooks/calendar/microsoft', {
      data: {
        value: [{
          subscriptionId: msSubscriptionId,
          clientState: msClientState,
          changeType: 'updated',
          resourceData: { id: msEventId },
          mockMovedStart: MOVED_START,
          mockMovedEnd: MOVED_END,
        }],
      },
    })
    expect(moveRes.status()).toBe(200)
    const { data: moved } = await admin
      .from('appointments')
      .select('start_time, end_time, status')
      .eq('id', msApptId)
      .single()
    expect(moved?.status).toBe('booked')
    expect(new Date(moved!.start_time).toISOString()).toBe(MOVED_START)
    expect(new Date(moved!.end_time).toISOString()).toBe(MOVED_END)
  })

  test('Microsoft webhook rejects invalid client state', async ({ request }) => {
    const res = await request.post('/api/webhooks/calendar/microsoft', {
      data: {
        value: [{
          subscriptionId: msSubscriptionId,
          clientState: 'not-the-secret',
          changeType: 'deleted',
          resourceData: { id: msEventId },
        }],
      },
    })
    expect(res.status()).toBe(403)
  })

  test('renewal cron skips live provider calls when registration disabled', async ({ request }) => {
    const cron = process.env.CRON_SECRET || 'mock_cron_secret_for_local_testing'
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const admin = adminClient()
    const rows = await listSubscriptionsExpiringBefore(admin, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
    const googleRow = rows.find((r) => r.channel_id === googleChannelId)
    expect(googleRow).toBeTruthy()
    if (googleRow) {
      await mockRenewSubscriptionRow(admin, googleRow, soon)
    }

    const libResult = await renewCalendarPushSubscriptions(admin)
    expect(libResult.skipped).toBeGreaterThanOrEqual(1)
    expect(libResult.renewed).toBe(0)

    const res = await request.post('/api/calendar/push-subscriptions/renew', {
      headers: {
        Authorization: `Bearer ${cron}`,
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.renewed).toBe(0)
    expect(body.skipped).toBeGreaterThanOrEqual(1)
  })
})