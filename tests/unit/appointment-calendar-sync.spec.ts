import { test, expect } from '@playwright/test'
import {
  rowHasReconcilableProviderEventId,
  defaultVerifyCalendarEvent,
  resolveBusyAppointmentIntervals,
  fetchOverlappingAppointments,
  AppointmentOverlapQueryError,
  type OverlappingAppointmentRow,
} from '../../src/lib/booking/appointment-calendar-sync'
import { createClient } from '@supabase/supabase-js'

test.describe('appointment-calendar-sync', () => {
  test('rwg- synthetic google_event_id is not reconciled', () => {
    const row: OverlappingAppointmentRow = {
      id: '1',
      staff_id: 's1',
      start_time: '2026-11-23T10:00:00.000Z',
      end_time: '2026-11-23T10:30:00.000Z',
      google_event_id: `rwg-${Date.now()}`,
    }
    expect(rowHasReconcilableProviderEventId(row)).toBe(false)
  })

  test('synthetic rwg row stays booked when verifier would mark missing', async () => {
    const missingVerifier = async () => ({ kind: 'missing' as const })
    const admin = createClient('http://127.0.0.1:54321', 'service-role', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const busy = await resolveBusyAppointmentIntervals({
      admin,
      tenantId: 'tenant',
      staffById: new Map([['s1', { id: 's1', google_calendar_id: 'primary' }]]),
      windowStart: new Date('2026-11-23T09:00:00.000Z'),
      windowEnd: new Date('2026-11-23T12:00:00.000Z'),
      rows: [{
        id: '1',
        staff_id: 's1',
        start_time: '2026-11-23T10:00:00.000Z',
        end_time: '2026-11-23T10:30:00.000Z',
        google_event_id: 'rwg-12345',
        status: 'booked',
      }],
      verify: missingVerifier,
    })
    expect(busy).toHaveLength(1)
  })

  test('real google_event_id is reconciled', async () => {
    expect(rowHasReconcilableProviderEventId({
      id: '1',
      staff_id: 's1',
      start_time: 'x',
      end_time: 'y',
      google_event_id: 'abc123real',
    })).toBe(true)
  })

  test('fetchOverlappingAppointments throws on DB error', async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({
                gt: () => ({
                  in: () => Promise.resolve({ data: null, error: { message: 'db down' } }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createClient>

    await expect(
      fetchOverlappingAppointments(
        broken,
        'tenant',
        new Date(),
        new Date(),
        ['staff-1'],
      ),
    ).rejects.toBeInstanceOf(AppointmentOverlapQueryError)
  })

  test('defaultVerify skips synthetic rwg id without API call', async () => {
    const state = await defaultVerifyCalendarEvent('tenant', { id: 's1' }, {
      id: '1',
      staff_id: 's1',
      start_time: 'x',
      end_time: 'y',
      google_event_id: 'rwg-999',
    })
    expect(state.kind).toBe('skipped')
  })
})