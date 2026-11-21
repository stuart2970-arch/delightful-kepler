import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })
import { getAvailabilityData } from '../src/app/api/chat/stream/calendar'
import type { VerifyCalendarEvent } from '../src/lib/booking/appointment-calendar-sync'
import { resolveBusyAppointmentIntervals } from '../src/lib/booking/appointment-calendar-sync'
import { staffIdsBlockingSlot } from '../src/lib/booking/rwg-slot-busy'
import type { StaffCalendarTarget } from '../src/lib/calendar/provider'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const WINDOW_START = '2026-11-23T09:00:00+00:00'
const WINDOW_END = '2026-11-23T12:00:00+00:00'
const NOW = new Date('2026-11-23T08:00:00.000Z')
const SLOT_START = '2026-11-23T10:00:00.000Z'
const SLOT_END = '2026-11-23T10:30:00.000Z'

const assistedSetup = {
  id: 'svc-styl392',
  name: 'Consultation',
  duration_minutes: 30,
  buffer_minutes: 0,
  price: 25,
}

function rotaStaff(id: string, name: string) {
  return {
    id,
    name,
    calendar_provider: 'google',
    google_calendar_id: 'primary',
    working_days: {
      monday: {
        unavailable: false,
        am: { start: '09:00', end: '12:00' },
        pm: null,
      },
    },
  }
}

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-392 cancelled calendar events free slots', () => {
  let tenantId = ''
  let staffId = ''
  let serviceId = ''
  let appointmentId = ''

  test.beforeAll(async () => {
    const admin = adminClient()
    const suffix = `styl392-${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({ company_name: `STYL-392 ${suffix}`, slug: `styl392-${suffix}` })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    tenantId = tenant!.id

    const { data: staff, error: staffErr } = await admin
      .from('staff')
      .insert({
        tenant_id: tenantId,
        name: 'Alex',
        email: `${suffix}@example.com`,
        calendar_provider: 'google',
        google_calendar_id: 'primary',
        working_days: rotaStaff('x', 'Alex').working_days,
      })
      .select('id')
      .single()
    expect(staffErr).toBeNull()
    staffId = staff!.id

    const { data: service, error: serviceErr } = await admin
      .from('services')
      .insert({
        tenant_id: tenantId,
        name: assistedSetup.name,
        duration_minutes: 30,
        buffer_minutes: 0,
        price: 25,
      })
      .select('id')
      .single()
    expect(serviceErr).toBeNull()
    serviceId = service!.id
  })

  test.afterAll(async () => {
    if (!tenantId) return
    const admin = adminClient()
    await admin.from('appointments').delete().eq('tenant_id', tenantId)
    await admin.from('services').delete().eq('tenant_id', tenantId)
    await admin.from('staff').delete().eq('tenant_id', tenantId)
    await admin.from('tenants').delete().eq('id', tenantId)
  })

  test.afterEach(async () => {
    if (!appointmentId) return
    const admin = adminClient()
    await admin.from('appointments').delete().eq('id', appointmentId)
    appointmentId = ''
  })

  const missingVerifier: VerifyCalendarEvent = async () => ({ kind: 'missing' })
  const activeVerifier: VerifyCalendarEvent = async () => ({ kind: 'active' })
  const errorVerifier: VerifyCalendarEvent = async () => ({ kind: 'error' })
  const movedVerifier: VerifyCalendarEvent = async () => ({
    kind: 'active',
    startIso: '2026-11-23T11:00:00.000Z',
    endIso: '2026-11-23T11:30:00.000Z',
  })

  test('marks row cancelled and offers slot when Google event is missing (chat availability)', async () => {
    const admin = adminClient()
    const { data: appt, error } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: serviceId,
        customer_name: 'Casey',
        customer_email: `casey-${Date.now()}@example.com`,
        start_time: SLOT_START,
        end_time: SLOT_END,
        status: 'booked',
        google_event_id: 'evt-deleted-in-google',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    appointmentId = appt!.id

    const freed = await getAvailabilityData(
      tenantId,
      staffId,
      serviceId,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        lookup: async () => [],
        verifyCalendarEvent: missingVerifier,
      },
    )

    expect(freed.outcome).toBe('ok')
    expect(freed.slots.some((slot) => slot.time === '10:00')).toBe(true)

    const { data: row } = await admin.from('appointments').select('status').eq('id', appointmentId).single()
    expect(row?.status).toBe('cancelled')
  })

  test('still-valid Google event keeps slot blocked', async () => {
    const admin = adminClient()
    const { data: appt, error } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: serviceId,
        customer_name: 'Dana',
        customer_email: `dana-${Date.now()}@example.com`,
        start_time: SLOT_START,
        end_time: SLOT_END,
        status: 'booked',
        google_event_id: 'evt-still-there',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    appointmentId = appt!.id

    const blocked = await getAvailabilityData(
      tenantId,
      staffId,
      serviceId,
      WINDOW_START,
      WINDOW_END,
      'Europe/London',
      {
        now: NOW,
        lookup: async () => [],
        verifyCalendarEvent: activeVerifier,
      },
    )

    expect(blocked.slots.some((slot) => slot.time === '10:00')).toBe(false)
    const { data: row } = await admin.from('appointments').select('status').eq('id', appointmentId).single()
    expect(row?.status).toBe('booked')
  })

  test('API error fails closed (slot stays blocked)', async () => {
    const admin = adminClient()
    const staffTarget: StaffCalendarTarget = { id: staffId, google_calendar_id: 'primary' }
    const busy = await resolveBusyAppointmentIntervals({
      admin,
      tenantId,
      staffById: new Map([[staffId, staffTarget]]),
      windowStart: new Date(SLOT_START),
      windowEnd: new Date(SLOT_END),
      rows: [{
        id: 'test-row',
        staff_id: staffId,
        start_time: SLOT_START,
        end_time: SLOT_END,
        google_event_id: 'evt-api-error',
        status: 'booked',
      }],
      verify: errorVerifier,
    })
    expect(busy.length).toBe(1)
  })

  test('moved event updates row times and only blocks new window', async () => {
    const admin = adminClient()
    const { data: appt, error } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        staff_id: staffId,
        service_id: serviceId,
        customer_name: 'Eve',
        customer_email: `eve-${Date.now()}@example.com`,
        start_time: SLOT_START,
        end_time: SLOT_END,
        status: 'booked',
        google_event_id: 'evt-moved',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    appointmentId = appt!.id

    const staffTarget: StaffCalendarTarget = { id: staffId, google_calendar_id: 'primary' }
    const busyMorning = await resolveBusyAppointmentIntervals({
      admin,
      tenantId,
      staffById: new Map([[staffId, staffTarget]]),
      windowStart: new Date(WINDOW_START),
      windowEnd: new Date(WINDOW_END),
      rows: [{
        id: appointmentId,
        staff_id: staffId,
        start_time: SLOT_START,
        end_time: SLOT_END,
        google_event_id: 'evt-moved',
        status: 'booked',
      }],
      verify: movedVerifier,
    })

    expect(busyMorning.length).toBe(1)
    expect(new Date(busyMorning[0]?.start_time || '').toISOString()).toBe('2026-11-23T11:00:00.000Z')

    const { data: row } = await admin
      .from('appointments')
      .select('start_time, end_time, status')
      .eq('id', appointmentId)
      .single()
    expect(row?.status).toBe('booked')
    expect(new Date(row?.start_time || '').toISOString()).toBe('2026-11-23T11:00:00.000Z')
  })

  test('staffIdsBlockingSlot ignores cancelled rows (RwG/v3 path)', async () => {
    const admin = adminClient()
    await admin.from('appointments').insert({
      tenant_id: tenantId,
      staff_id: staffId,
      service_id: serviceId,
      customer_name: 'Frank',
      customer_email: `frank-${Date.now()}@example.com`,
      start_time: SLOT_START,
      end_time: SLOT_END,
      status: 'cancelled',
      google_event_id: 'evt-cancelled-row',
    })

    const blocking = await staffIdsBlockingSlot({
      admin,
      tenantId,
      slotStart: new Date(SLOT_START),
      slotEnd: new Date(SLOT_END),
      staffById: new Map([[staffId, { id: staffId, google_calendar_id: 'primary' }]]),
    })
    expect(blocking.size).toBe(0)
  })
})