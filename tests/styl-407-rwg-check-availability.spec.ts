import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { verifyRwgBookingServerAuth } from '../src/lib/booking/rwg-booking-auth'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const rwgUser = process.env.RWG_BOOKING_SERVER_USERNAME || 'styleflo-rwg-test'
const rwgPassword = process.env.RWG_BOOKING_SERVER_PASSWORD || 'styleflo-rwg-test-password'

const ACME_TENANT = '10000000-0000-0000-0000-000000000001'
const ACME_SERVICE = '40000000-0000-0000-0000-000000000001'
const SLOT_START = '2027-08-01T10:00:00.000Z'
const SLOT_END = '2027-08-01T11:00:00.000Z'

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-407 Reserve with Google CheckAvailability', () => {
  let tenantId = ''
  let serviceId = ''
  let staffId = ''
  let appointmentId = ''

  test.beforeAll(async () => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    const admin = adminClient()
    const suffix = `rwg-${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ company_name: `Rwg Check ${suffix}`, slug: `rwg-check-${suffix}` })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    tenantId = tenant!.id

    const { data: service, error: serviceErr } = await admin
      .from('services')
      .insert({ tenant_id: tenantId, name: 'Cut', duration_minutes: 60, buffer_minutes: 0, price: 20 })
      .select('id')
      .single()
    expect(serviceErr).toBeNull()
    serviceId = service!.id

    const { data: staff, error: staffErr } = await admin
      .from('staff')
      .insert({
        tenant_id: tenantId,
        name: 'Alex',
        email: `${suffix}@example.test`,
        avatar_url: null,
        bio: 'catch-up column',
        google_access_token: null,
        google_refresh_token: null,
        google_token_expiry: null,
      })
      .select('id')
      .single()
    expect(staffErr).toBeNull()
    staffId = staff!.id
  })

  test.afterAll(async () => {
    const admin = adminClient()
    if (appointmentId) await admin.from('appointments').delete().eq('id', appointmentId)
    if (staffId) await admin.from('staff').delete().eq('id', staffId)
    if (serviceId) await admin.from('services').delete().eq('id', serviceId)
    if (tenantId) await admin.from('tenants').delete().eq('id', tenantId)
  })

  test('missing partner credentials fail closed with no availability body', async () => {
    const result = verifyRwgBookingServerAuth(
      new Request('http://localhost/api/v3/CheckAvailability', { method: 'POST' }),
      {},
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(503)
    const body = await result.response.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(body.slot_available).toBeUndefined()
  })

  test('rejects a missing or wrong Basic header', async ({ request }) => {
    const missing = await request.post('/api/v3/CheckAvailability', { data: {} })
    expect(missing.status()).toBe(401)
    expect(missing.headers()['www-authenticate']).toContain('Reserve with Google')

    const wrong = await request.post('/api/v3/CheckAvailability', {
      headers: { Authorization: basic('styleflo-rwg-test', 'not-the-password') },
      data: { slot: { merchant_id: tenantId, service_id: serviceId, start_time_sec: 1 } },
    })
    expect(wrong.status()).toBe(401)
    const body = await wrong.json()
    expect(body.slot_available).toBeUndefined()
  })

  test('reports a free slot for the service that belongs to the merchant', async ({ request }) => {
    const startSec = Math.floor(Date.parse(SLOT_START) / 1000)
    const response = await request.post('/api/v3/CheckAvailability', {
      headers: { Authorization: basic(rwgUser, rwgPassword) },
      data: { slot: { merchant_id: tenantId, service_id: serviceId, start_time_sec: startSec } },
    })
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ slot_available: true, duration_sec: 3600 })
  })

  test('reports the slot unavailable once it is booked', async ({ request }) => {
    const admin = adminClient()
    const { data, error } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: serviceId,
        customer_name: 'Booked Guest',
        customer_email: `booked-${Date.now()}@example.test`,
        start_time: SLOT_START,
        end_time: SLOT_END,
        status: 'booked',
        is_blockout: false,
        blockout_reason: null,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    appointmentId = data!.id

    const startSec = Math.floor(Date.parse(SLOT_START) / 1000)
    const response = await request.post('/api/v3/CheckAvailability', {
      headers: { Authorization: basic(rwgUser, rwgPassword) },
      data: { slot: { merchant_id: tenantId, service_id: serviceId, start_time_sec: startSec } },
    })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.slot_available).toBe(false)
    expect(body.error).toBe('SLOT_UNAVAILABLE')
  })

  test('does not treat another merchant id as the service id', async ({ request }) => {
    const startSec = Math.floor(Date.parse('2027-08-02T10:00:00.000Z') / 1000)
    const crossed = await request.post('/api/v3/CheckAvailability', {
      headers: { Authorization: basic(rwgUser, rwgPassword) },
      data: {
        slot: {
          merchant_id: tenantId,
          service_id: ACME_SERVICE,
          start_time_sec: startSec,
        },
      },
    })
    expect(crossed.status()).toBe(200)
    expect(await crossed.json()).toMatchObject({
      error: 'SERVICE_UNAVAILABLE',
      description: 'The requested service does not exist.',
    })

    const unknown = await request.post('/api/v3/CheckAvailability', {
      headers: { Authorization: basic(rwgUser, rwgPassword) },
      data: {
        slot: {
          merchant_id: ACME_TENANT,
          service_id: '00000000-0000-0000-0000-000000000099',
          start_time_sec: startSec,
        },
      },
    })
    expect(await unknown.json()).toMatchObject({ error: 'SERVICE_UNAVAILABLE' })
  })
})
