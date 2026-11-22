import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { createTestUser } from './test-auth-helper'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const ACME = '10000000-0000-0000-0000-000000000001'

function userClient(token: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-412 staff Google token grants', () => {
  test.beforeAll(() => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(anonKey, 'local anon key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
  })

  test('an authenticated colleague cannot select staff Google tokens', async () => {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const member = await createTestUser({ tenantId: ACME, role: 'member' })
    const owner = await createTestUser({ tenantId: ACME, role: 'owner' })
    const staffId = crypto.randomUUID()
    const email = `token-staff-${Date.now()}@test.styleflo.ai`
    let ownerStaffId: string | null = null
    try {
      const { error: seedError } = await admin.from('staff').insert({
        id: staffId,
        tenant_id: ACME,
        name: 'Token Colleague',
        email,
        user_id: member.user.id,
        google_calendar_id: 'primary',
        google_access_token: 'access-secret',
        google_refresh_token: 'refresh-secret',
      })
      expect(seedError).toBeNull()

      const { data: serviceRow, error: serviceError } = await admin
        .from('staff')
        .select('google_access_token, google_refresh_token, google_connected')
        .eq('id', staffId)
        .single()
      expect(serviceError).toBeNull()
      expect(serviceRow?.google_access_token).toBe('access-secret')
      expect(serviceRow?.google_refresh_token).toBe('refresh-secret')
      expect(serviceRow?.google_connected).toBe(true)

      const colleague = userClient(member.token)
      const access = await colleague.from('staff').select('google_access_token').eq('id', staffId).maybeSingle()
      expect(access.data).toBeNull()
      expect(access.error).toBeTruthy()
      expect(access.error?.message || '').toMatch(/permission|column/i)

      const refresh = await colleague.from('staff').select('google_refresh_token').eq('id', staffId).maybeSingle()
      expect(refresh.data).toBeNull()
      expect(refresh.error).toBeTruthy()
      expect(refresh.error?.message || '').toMatch(/permission|column/i)

      const safe = await colleague
        .from('staff')
        .select('id, name, google_calendar_id, google_connected')
        .eq('id', staffId)
        .single()
      expect(safe.error).toBeNull()
      expect(safe.data).toMatchObject({
        id: staffId,
        name: 'Token Colleague',
        google_calendar_id: 'primary',
        google_connected: true,
      })
      expect(JSON.stringify(safe.data)).not.toContain('access-secret')
      expect(JSON.stringify(safe.data)).not.toContain('refresh-secret')

      const renamed = await colleague
        .from('staff')
        .update({ name: 'Token Colleague Updated' })
        .eq('id', staffId)
        .select('id, name, google_connected')
        .single()
      expect(renamed.error).toBeNull()
      expect(renamed.data).toMatchObject({
        id: staffId,
        name: 'Token Colleague Updated',
        google_connected: true,
      })

      const inserted = await userClient(owner.token)
        .from('staff')
        .insert({
          tenant_id: ACME,
          name: 'Owner Added',
          email: `owner-added-${Date.now()}@test.styleflo.ai`,
          google_calendar_id: 'primary',
        })
        .select('id, name, google_calendar_id, google_connected')
        .single()
      expect(inserted.error).toBeNull()
      ownerStaffId = inserted.data?.id ?? null
      expect(inserted.data).toMatchObject({
        name: 'Owner Added',
        google_calendar_id: 'primary',
        google_connected: false,
      })
    } finally {
      if (ownerStaffId) await admin.from('staff').delete().eq('id', ownerStaffId)
      await admin.from('staff').delete().eq('id', staffId)
      await owner.cleanup()
      await member.cleanup()
    }
  })
})
