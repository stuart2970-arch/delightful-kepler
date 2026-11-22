import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { createTestUser, type TestUserSession } from './test-auth-helper'
import { isRwgUiEnabled } from '../src/lib/rwg-ui'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function adminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('STYL-416 Reserve with Google hidden', () => {
  test('flag defaults off and only accepts explicit on values', () => {
    expect(isRwgUiEnabled({})).toBe(false)
    expect(isRwgUiEnabled({ RWG_UI_ENABLED: '' })).toBe(false)
    expect(isRwgUiEnabled({ RWG_UI_ENABLED: 'false' })).toBe(false)
    expect(isRwgUiEnabled({ RWG_UI_ENABLED: 'true' })).toBe(true)
    expect(isRwgUiEnabled({ RWG_UI_ENABLED: '1' })).toBe(true)
  })

  test('integrations page does not render the Reserve with Google card', async ({ page }) => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
    expect(isRwgUiEnabled(process.env)).toBe(false)

    const admin = adminClient()
    const suffix = `rwg-hide-${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({
        company_name: `Harbour Hide ${suffix}`,
        slug: `harbour-hide-${suffix}`,
        is_rwg_enabled: true,
        rwg_business_name: 'Should Stay Hidden',
      })
      .select('id')
      .single()
    expect(tenantErr).toBeNull()
    const tenantId = tenant!.id
    let session: TestUserSession | null = null

    try {
      session = await createTestUser({ tenantId, role: 'owner' })
      await page.goto('/login')
      await page.locator('input[type="email"]').fill(session.user.email)
      await page.locator('input[type="password"]').fill('Password123!')
      await page.locator('form button[type="submit"]').click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 })

      await page.goto('/dashboard?tab=integrations')
      await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId('rwg-integration-card')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: /Reserve with Google/i })).toHaveCount(0)
      await expect(page.getByText('Actions Center')).toHaveCount(0)
      await expect(page.getByText('Book Online')).toHaveCount(0)
      await expect(page.getByText('Authorize Google Integration')).toHaveCount(0)

      await page.goto('/dashboard?tab=account')
      await expect(page.getByRole('button', { name: 'Save Account Settings' })).toBeVisible({ timeout: 20000 })
      await expect(page.getByText(/Reserve with Google/i)).toHaveCount(0)
      await expect(page.getByText('Actions Center')).toHaveCount(0)
    } finally {
      if (session) await session.cleanup()
      await admin.from('tenants').delete().eq('id', tenantId)
    }
  })

  test('settings API ignores an attempt to enable Reserve with Google', async ({ request }) => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')

    const admin = adminClient()
    const suffix = `rwg-api-${Date.now()}`
    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({
        company_name: `Harbour Api ${suffix}`,
        slug: `harbour-api-${suffix}`,
        is_rwg_enabled: false,
        rwg_business_name: 'Stored Name',
        domain: 'before.example',
      })
      .select('id, is_rwg_enabled, rwg_business_name, domain')
      .single()
    expect(tenantErr).toBeNull()
    const tenantId = tenant!.id
    let session: TestUserSession | null = null

    try {
      session = await createTestUser({ tenantId, role: 'owner' })
      const domain = `kept-${suffix}.example`
      const res = await request.patch('/api/tenants/settings', {
        headers: { Authorization: `Bearer ${session.token}` },
        data: {
          tenantId,
          domain,
          rwgConfig: {
            is_rwg_enabled: true,
            rwg_business_name: 'Enabled From Ui',
            rwg_street_address: '1 Hidden Street',
            rwg_city: 'London',
            rwg_postcode: 'SW1A 1AA',
            rwg_phone: '+447700900123',
            is_registered_business_address: true,
          },
          rwgAddressSameAsTrading: false,
        },
      })
      expect(res.status()).toBe(200)
      const { data: stored, error } = await admin
        .from('tenants')
        .select('is_rwg_enabled, rwg_business_name, domain, rwg_address_same_as_trading')
        .eq('id', tenantId)
        .single()
      expect(error).toBeNull()
      expect(stored?.domain).toBe(domain)
      expect(stored?.is_rwg_enabled).toBe(false)
      expect(stored?.rwg_business_name).toBe('Stored Name')
      expect(stored?.rwg_address_same_as_trading).not.toBe(false)
    } finally {
      if (session) await session.cleanup()
      await admin.from('tenants').delete().eq('id', tenantId)
    }
  })
})
