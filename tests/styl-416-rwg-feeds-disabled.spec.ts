import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { isRwgUiEnabled } from '../src/lib/rwg-ui'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const FEEDS = [
  '/api/rwg/feeds/merchants',
  '/api/rwg/feeds/services',
  '/api/rwg/feeds/availability',
] as const

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function openDay() {
  return {
    unavailable: false,
    am: { start: '09:00', end: '17:00' },
    pm: null,
  }
}

test.describe('STYL-416 Reserve with Google feeds stay empty while the flag is off', () => {
  let tenantId = ''
  let serviceId = ''
  let companyName = ''
  let street = ''
  let phone = ''

  test.beforeAll(async () => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    expect(supabaseUrl).not.toContain('lriugykhrfnnouexqqhm')
    const suffix = `${Date.now()}`
    companyName = `Harbour Feed ${suffix}`
    street = `1 Feed Lane ${suffix}`
    phone = `+4477009${suffix.slice(-5)}`
    const admin = adminClient()
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({
        company_name: companyName,
        slug: `harbour-feed-${suffix}`,
        is_rwg_enabled: true,
        rwg_business_name: companyName,
        rwg_street_address: street,
        rwg_city: 'London',
        rwg_postcode: 'SW1A 1AA',
        rwg_phone: phone,
        booking_mode: 'single_calendar',
      })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    tenantId = tenant!.id

    const { data: service, error: serviceErr } = await admin
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: `Feed Cut ${suffix}`,
        duration_minutes: 30,
        buffer_minutes: 0,
        price: 25,
      })
      .select('id')
      .single()
    expect(serviceErr).toBeNull()
    serviceId = service!.id

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const workingDays = Object.fromEntries(days.map((day) => [day, openDay()]))
    const { error: staffErr } = await admin.from('staff').insert({
      tenant_id: tenantId,
      name: 'Feed Alex',
      email: `feed-${suffix}@example.test`,
      working_days: workingDays,
    })
    expect(staffErr).toBeNull()
  })

  test.afterAll(async () => {
    if (tenantId) await adminClient().from('tenants').delete().eq('id', tenantId)
  })

  test('flag off returns an empty feed and does not run cron', async ({ request }) => {
    delete process.env.RWG_UI_ENABLED
    expect(isRwgUiEnabled()).toBe(false)

    for (const feedPath of FEEDS) {
      const response = await request.get(feedPath)
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toEqual([])
      const serialised = JSON.stringify(body)
      expect(serialised).not.toContain(tenantId)
      expect(serialised).not.toContain(companyName)
      expect(serialised).not.toContain(street)
      expect(serialised).not.toContain(phone)
      expect(serialised).not.toContain(serviceId)
    }

    const cron = await request.get('/api/rwg/feeds/cron')
    expect(cron.status()).toBe(200)
    const cronBody = await cron.json()
    expect(cronBody.success).toBe(true)
    expect(cronBody.message).toBe('Reserve with Google feeds are disabled.')
    expect(cronBody.message).not.toMatch(/published|aggregated/i)
    const cronText = JSON.stringify(cronBody)
    expect(cronText).not.toContain(tenantId)
    expect(cronText).not.toContain(companyName)
  })

  test('flag on still returns the enabled tenant from each feed', async () => {
    process.env.RWG_UI_ENABLED = 'true'
    expect(isRwgUiEnabled()).toBe(true)
    try {
      const { GET: merchantsGet } = await import('../src/app/api/rwg/feeds/merchants/route')
      const { GET: servicesGet } = await import('../src/app/api/rwg/feeds/services/route')
      const { GET: availabilityGet } = await import('../src/app/api/rwg/feeds/availability/route')
      const { GET: cronGet } = await import('../src/app/api/rwg/feeds/cron/route')

      const merchantsResponse = await merchantsGet()
      expect(merchantsResponse.status).toBe(200)
      const merchants = await merchantsResponse.json()
      const merchant = merchants.find((row: { merchant?: { id?: string } }) => row.merchant?.id === tenantId)
      expect(merchant).toBeTruthy()
      expect(merchant.merchant.name).toBe(companyName)
      expect(merchant.merchant.address.address_line).toContain(street)
      expect(merchant.merchant.telephone).toBe(phone)

      const servicesResponse = await servicesGet()
      expect(servicesResponse.status).toBe(200)
      const services = await servicesResponse.json()
      const service = services.find((row: { service?: { id?: string } }) => row.service?.id === serviceId)
      expect(service?.service?.merchant_id).toBe(tenantId)

      const availabilityResponse = await availabilityGet()
      expect(availabilityResponse.status).toBe(200)
      const availability = await availabilityResponse.json()
      expect(availability.some((row: { availability?: { merchant_id?: string } }) => row.availability?.merchant_id === tenantId)).toBe(true)

      const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
      const cronResponse = await cronGet(new Request('http://localhost/api/rwg/feeds/cron', {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }))
      expect(cronResponse.status).toBe(200)
      const cronBody = await cronResponse.json()
      expect(cronBody.success).toBe(true)
      expect(cronBody.message).toMatch(/aggregated successfully/i)
      expect(JSON.stringify(cronBody)).not.toContain(companyName)
    } finally {
      delete process.env.RWG_UI_ENABLED
    }
  })
})
