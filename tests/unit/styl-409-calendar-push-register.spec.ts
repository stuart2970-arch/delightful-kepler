import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import {
  backfillMissingCalendarPushSubscriptions,
  ensureGoogleCalendarPushWatch,
  ensureMicrosoftCalendarPushSubscription,
  isLiveSubscription,
  onStaffGoogleCalendarIdChanged,
} from '../../src/lib/calendar/push-sync/register-lifecycle'
import type { CalendarPushSubscriptionRow } from '../../src/lib/calendar/push-sync/subscription-store'

const NOW = Date.parse('2026-11-22T12:00:00.000Z')

type SubRow = CalendarPushSubscriptionRow

type FilterMap = Record<string, string>

function matchingRows(rows: SubRow[], filters: FilterMap): SubRow[] {
  return rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => String((row as Record<string, string>)[key]) === value),
  )
}

function subscriptionQuery(rows: SubRow[], filters: FilterMap = {}) {
  const chain = {
    select: () => subscriptionQuery(rows, filters),
    eq: (col: string, val: string) => subscriptionQuery(rows, { ...filters, [col]: val }),
    maybeSingle: () =>
      Promise.resolve({ data: matchingRows(rows, filters)[0] ?? null, error: null }),
    delete: () => ({
      eq: (_col: string, id: string) => {
        const index = rows.findIndex((row) => row.id === id)
        if (index >= 0) rows.splice(index, 1)
        return Promise.resolve({ error: null })
      },
    }),
    then: (
      onFulfilled: (value: { data: SubRow[]; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: matchingRows(rows, filters), error: null }).then(onFulfilled, onRejected),
  }
  return chain
}

function memoryStore(initial: SubRow[] = []) {
  const rows = [...initial]
  return {
    rows,
    admin: {
      from: (table: string) => {
        if (table === 'calendar_push_subscriptions') {
          return {
            select: () => subscriptionQuery(rows),
            upsert: (payload: Partial<SubRow>) => {
              const index = rows.findIndex(
                (row) => row.provider === payload.provider && row.channel_id === payload.channel_id,
              )
              if (index >= 0) {
                rows[index] = { ...rows[index], ...payload } as SubRow
              } else {
                rows.push({
                  id: randomUUID(),
                  tenant_id: String(payload.tenant_id),
                  provider: payload.provider as SubRow['provider'],
                  calendar_id: String(payload.calendar_id),
                  channel_id: String(payload.channel_id),
                  resource_id: payload.resource_id ?? null,
                  verification_token: String(payload.verification_token),
                  expires_at: String(payload.expires_at),
                })
              }
              return Promise.resolve({ error: null })
            },
            delete: () => ({
              eq: (_col: string, id: string) => {
                const index = rows.findIndex((row) => row.id === id)
                if (index >= 0) rows.splice(index, 1)
                return Promise.resolve({ error: null })
              },
            }),
          }
        }
        if (table === 'tenant_integrations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { refresh_token: 'rt' }, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'tenants') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }
        }
        if (table === 'staff') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { google_calendar_id: 'primary', calendar_provider: 'google' },
                    { google_calendar_id: 'other@example.com', calendar_provider: 'google' },
                  ],
                  error: null,
                }),
            }),
          }
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      },
    } as unknown as ReturnType<typeof createClient>,
  }
}

test.describe('STYL-409 calendar push registration lifecycle', () => {
  test('ensureGoogleCalendarPushWatch is idempotent when a live row exists', async () => {
    const store = memoryStore([
      {
        id: 'sub-1',
        tenant_id: 'tenant-1',
        provider: 'google',
        calendar_id: 'primary',
        channel_id: 'ch-1',
        resource_id: 'res-1',
        verification_token: 'tok',
        expires_at: '2026-12-01T00:00:00.000Z',
      },
    ])
    let registerCalls = 0
    const prevEnv = { ...process.env }
    process.env.CALENDAR_PUSH_REGISTER_IN_TESTS = 'true'
    try {
      const status = await ensureGoogleCalendarPushWatch(
        store.admin,
        'tenant-1',
        'primary',
        {
          now: () => NOW,
          registerGoogle: async () => {
            registerCalls += 1
            return { channelId: 'x', resourceId: 'y', expirationMs: NOW, verificationToken: 'z' }
          },
        },
      )
      expect(status).toBe('skipped')
      expect(registerCalls).toBe(0)
    } finally {
      process.env = prevEnv
    }
  })

  test('ensureGoogleCalendarPushWatch registers when no live row exists', async () => {
    const store = memoryStore()
    let registerCalls = 0
    const prevEnv = { ...process.env }
    process.env.CALENDAR_PUSH_REGISTER_IN_TESTS = 'true'
    try {
      const status = await ensureGoogleCalendarPushWatch(
        store.admin,
        'tenant-1',
        'primary',
        {
          now: () => NOW,
          registerGoogle: async () => {
            registerCalls += 1
            return { channelId: 'ch', resourceId: 'res', expirationMs: NOW + 1e6, verificationToken: 't' }
          },
        },
      )
      expect(status).toBe('registered')
      expect(registerCalls).toBe(1)
    } finally {
      process.env = prevEnv
    }
  })

  test('onStaffGoogleCalendarIdChanged stops old watch and registers new calendar', async () => {
    const store = memoryStore([
      {
        id: 'sub-old',
        tenant_id: 'tenant-1',
        provider: 'google',
        calendar_id: 'old@example.com',
        channel_id: 'ch-old',
        resource_id: 'res-old',
        verification_token: 'tok',
        expires_at: '2026-12-01T00:00:00.000Z',
      },
    ])
    const stopped: string[] = []
    const registered: string[] = []
    const admin = {
      from: (table: string) => {
        if (table === 'staff') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ google_calendar_id: 'new@example.com', calendar_provider: 'google' }],
                  error: null,
                }),
            }),
          }
        }
        if (table === 'tenant_integrations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { refresh_token: 'rt' }, error: null }),
                }),
              }),
            }),
          }
        }
        return store.admin.from(table)
      },
    } as unknown as ReturnType<typeof createClient>
    const prevEnv = { ...process.env }
    process.env.CALENDAR_PUSH_REGISTER_IN_TESTS = 'true'
    try {
      await onStaffGoogleCalendarIdChanged(
        admin,
        'tenant-1',
        'old@example.com',
        'new@example.com',
        {
          now: () => NOW,
          stopGoogle: async (_a, _t, channelId) => {
            stopped.push(channelId)
          },
          registerGoogle: async (_a, _t, calendarId) => {
            registered.push(calendarId)
            return { channelId: 'ch-new', resourceId: 'res-new', expirationMs: NOW + 1e6, verificationToken: 't' }
          },
        },
      )
      expect(stopped).toEqual(['ch-old'])
      expect(registered).toEqual(['new@example.com'])
      expect(store.rows.some((r) => r.calendar_id === 'old@example.com')).toBe(false)
    } finally {
      process.env = prevEnv
    }
  })

  test('backfill registers missing watches without duplicate calls', async () => {
    const subRows: SubRow[] = []
    const registerCalls: string[] = []
    const upsertRow = (provider: SubRow['provider'], calendarId: string, channelId: string) => {
      subRows.push({
        id: randomUUID(),
        tenant_id: 'tenant-1',
        provider,
        calendar_id: calendarId,
        channel_id: channelId,
        resource_id: provider === 'google' ? 'res' : null,
        verification_token: 'tok',
        expires_at: '2026-12-01T00:00:00.000Z',
      })
    }
    const registerGoogle = async (_admin: unknown, _tenantId: string, calendarId: string) => {
      registerCalls.push(`google:${calendarId}`)
      upsertRow('google', calendarId, randomUUID())
      return { channelId: 'ch', resourceId: 'res', expirationMs: NOW + 1e6, verificationToken: 't' }
    }
    const registerMicrosoft = async () => {
      registerCalls.push('microsoft')
      upsertRow('microsoft', 'me/events', randomUUID())
      return { subscriptionId: randomUUID(), expirationIso: '2026-12-01T00:00:00.000Z', clientState: 'c' }
    }
    const prevEnv = { ...process.env }
    process.env.CALENDAR_PUSH_REGISTER_IN_TESTS = 'true'
    try {
      const admin = {
        from: (table: string) => {
          if (table === 'tenants') {
            return {
              select: (cols?: string) => {
                if (cols === 'id') {
                  return Promise.resolve({ data: [{ id: 'tenant-1' }], error: null })
                }
                return {
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: { microsoft_refresh_token: 'ms' }, error: null }),
                  }),
                }
              },
            }
          }
          if (table === 'staff') {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [{ google_calendar_id: 'primary', calendar_provider: 'google' }],
                    error: null,
                  }),
              }),
            }
          }
          if (table === 'tenant_integrations') {
            return {
              select: () => ({
                eq: (_c: string, tenantId: string) => ({
                  eq: (_c2: string, provider: string) => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data:
                          tenantId === 'tenant-1'
                            ? { refresh_token: provider === 'google_calendar' ? 'g' : 'm' }
                            : null,
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === 'calendar_push_subscriptions') {
            return { select: () => subscriptionQuery(subRows) }
          }
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
        },
      } as unknown as ReturnType<typeof createClient>

      const first = await backfillMissingCalendarPushSubscriptions(admin, {
        now: () => NOW,
        registerGoogle,
        registerMicrosoft,
      })
      expect(first.registered).toBe(2)
      expect(registerCalls).toEqual(['google:primary', 'microsoft'])

      const second = await backfillMissingCalendarPushSubscriptions(admin, {
        now: () => NOW,
        registerGoogle,
        registerMicrosoft,
      })
      expect(second.registered).toBe(0)
      expect(second.skipped).toBe(2)
      expect(registerCalls).toHaveLength(2)
    } finally {
      process.env = prevEnv
    }
  })

  test('isLiveSubscription respects expires_at', () => {
    const row: SubRow = {
      id: '1',
      tenant_id: 't',
      provider: 'google',
      calendar_id: 'primary',
      channel_id: 'c',
      resource_id: 'r',
      verification_token: 'v',
      expires_at: '2026-12-01T00:00:00.000Z',
    }
    expect(isLiveSubscription(row, NOW)).toBe(true)
    expect(isLiveSubscription(row, Date.parse('2027-01-01T00:00:00.000Z'))).toBe(false)
  })

  test('ensureMicrosoftCalendarPushSubscription skips when live row exists', async () => {
    const store = memoryStore([
      {
        id: 'ms-1',
        tenant_id: 'tenant-1',
        provider: 'microsoft',
        calendar_id: 'me/events',
        channel_id: 'sub-1',
        resource_id: null,
        verification_token: 'cs',
        expires_at: '2026-12-01T00:00:00.000Z',
      },
    ])
    let registerCalls = 0
    const prevEnv = { ...process.env }
    process.env.CALENDAR_PUSH_REGISTER_IN_TESTS = 'true'
    try {
      const status = await ensureMicrosoftCalendarPushSubscription(store.admin, 'tenant-1', {
        now: () => NOW,
        registerMicrosoft: async () => {
          registerCalls += 1
          return { subscriptionId: 'x', expirationIso: '2026-12-02T00:00:00.000Z', clientState: 'y' }
        },
      })
      expect(status).toBe('skipped')
      expect(registerCalls).toBe(0)
    } finally {
      process.env = prevEnv
    }
  })
})