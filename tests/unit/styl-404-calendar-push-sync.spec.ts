import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  processMicrosoftNotifications,
  reconcileGoogleCalendarPush,
  stripMicrosoftNotificationTestFields,
} from '../../src/lib/calendar/push-sync/reconcile'
import { staffUsesGoogleCalendar } from '../../src/lib/calendar/push-sync/staff-google-calendar'
import type { VerifyCalendarEvent } from '../../src/lib/booking/appointment-calendar-sync'
import { handleMicrosoftCalendarWebhook } from '../../src/lib/calendar/push-sync/microsoft-webhook'

test.describe('STYL-404 calendar push review fixes', () => {
  test('stripMicrosoftNotificationTestFields removes mocks outside test env', () => {
    const item = {
      subscriptionId: 'sub-1',
      changeType: 'updated',
      mockMovedStart: '2026-01-01T10:00:00.000Z',
      mockMovedEnd: '2026-01-01T10:30:00.000Z',
    }
    const stripped = stripMicrosoftNotificationTestFields(item, {
      ...process.env,
      PLAYWRIGHT_TEST: '',
      NODE_ENV: 'production',
    })
    expect(stripped).toEqual({ subscriptionId: 'sub-1', changeType: 'updated' })
  })

  test('deleted notifications verify against Graph instead of trusting changeType alone', async () => {
    const calls: string[] = []
    const verify: VerifyCalendarEvent = async () => {
      calls.push('verify')
      return { kind: 'missing' }
    }
    const admin = {
      from: (table: string) => {
        if (table === 'appointments') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({
                      data: {
                        id: 'appt-1',
                        staff_id: 'staff-1',
                        start_time: '2026-11-23T10:00:00.000Z',
                        end_time: '2026-11-23T10:30:00.000Z',
                        microsoft_event_id: 'evt-1',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      },
    } as unknown as ReturnType<typeof createClient>

    const staffById = new Map([
      ['staff-1', { id: 'staff-1', calendar_provider: 'microsoft' }],
    ])

    const { processed } = await processMicrosoftNotifications(
      admin,
      'tenant-1',
      [{ changeType: 'deleted', resourceData: { id: 'evt-1' } }],
      { verify, staffById },
    )
    expect(calls).toEqual(['verify'])
    expect(processed).toBe(1)
  })

  test('reconcileGoogleCalendarPush only touches staff on the notified calendar', async () => {
    const verifiedStaff: string[] = []
    const verify: VerifyCalendarEvent = async (_tenant, staff) => {
      verifiedStaff.push(staff.id)
      return { kind: 'skipped' }
    }
    const admin = {
      from: (table: string) => {
        if (table === 'appointments') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    gte: () => ({
                      lte: () => Promise.resolve({
                        data: [
                          {
                            id: 'a1',
                            staff_id: 'primary-staff',
                            start_time: '2026-12-01T10:00:00.000Z',
                            end_time: '2026-12-01T11:00:00.000Z',
                            google_event_id: 'g1',
                          },
                          {
                            id: 'a2',
                            staff_id: 'other-cal',
                            start_time: '2026-12-01T10:00:00.000Z',
                            end_time: '2026-12-01T11:00:00.000Z',
                            google_event_id: 'g2',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      },
    } as unknown as ReturnType<typeof createClient>

    const staffById = new Map([
      ['primary-staff', { id: 'primary-staff', google_calendar_id: 'primary' }],
      ['other-cal', { id: 'other-cal', google_calendar_id: 'team-calendar@example.com' }],
    ])

    expect(staffUsesGoogleCalendar(staffById.get('primary-staff')!, 'primary')).toBe(true)
    expect(staffUsesGoogleCalendar(staffById.get('other-cal')!, 'primary')).toBe(false)

    await reconcileGoogleCalendarPush(admin, 'tenant', 'primary', staffById, verify)
    expect(verifiedStaff).toEqual(['primary-staff'])
  })

  test('google renew registers new watch before deleting the stored row', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/calendar/push-sync/renew-subscriptions.ts'),
      'utf8',
    )
    const registerIdx = src.indexOf('registerGoogleCalendarWatch')
    const deleteIdx = src.indexOf('deleteCalendarPushSubscription')
    expect(registerIdx).toBeGreaterThan(-1)
    expect(deleteIdx).toBeGreaterThan(registerIdx)
    expect(src.indexOf('stopGoogleCalendarWatch')).toBeGreaterThan(registerIdx)
  })

  test('handleMicrosoftCalendarWebhook validates subscriptionId on every item', async () => {
    const admin = {
      from: (table: string) => {
        if (table === 'calendar_push_subscriptions') {
          return {
            select: () => ({
              eq: (_col: string, provider: string) => ({
                eq: (_col2: string, channelId: string) => ({
                  maybeSingle: () => Promise.resolve({
                    data: channelId === 'known-sub'
                      ? {
                          tenant_id: 'tenant-1',
                          verification_token: 'good-token',
                          provider,
                          channel_id: channelId,
                        }
                      : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      },
    } as unknown as ReturnType<typeof createClient>

    const bad = await handleMicrosoftCalendarWebhook(admin, [
      { subscriptionId: 'known-sub', clientState: 'good-token', resourceData: { id: 'e1' } },
      { subscriptionId: 'other-sub', clientState: 'good-token', resourceData: { id: 'e2' } },
    ])
    expect(bad).toMatchObject({ ok: false, status: 404 })
  })
})