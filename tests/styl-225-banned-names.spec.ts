import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import path from 'path'
import dotenv from 'dotenv'
import { createTestSuperadminUser, createTestUser } from './test-auth-helper'

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true })

const BLOCK = "Sorry, that name can't be used. Please choose a different one."
const REVIEW = "Thanks! We need to check this name. You can carry on setting up, and we'll review it shortly."
const TOO_SHORT = 'Web addresses need at least 3 characters.'
const RESERVED = 'That web address is reserved. Try adding your town, e.g. glamour-puss-leeds.'
const EMOJI = 'Please use letters and numbers only.'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ACME = '10000000-0000-0000-0000-000000000001'
const CONVERSATION = '50000000-0000-0000-0000-000000000001'

function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function suffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

test.describe.configure({ mode: 'serial' })

test.describe('STYL-225 banned words and reserved names', () => {
  test.beforeAll(() => {
    expect(serviceRoleKey, 'local service role key').not.toEqual('')
    expect(supabaseUrl).not.toContain('tkoasyjvrgaglofpzduq')
  })

  test('check-slug fails closed when the service role key is missing', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/tenants/check-slug/route.ts'), 'utf8')
    expect(source).toContain('if (!supabaseUrl || !serviceRoleKey)')
    expect(source).toContain("error: 'Name check is unavailable.'")
    expect(source).toContain('status: 503')
    expect(source).not.toContain('anonClient')
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  test('reserved slugs admin and StyleFlo return the reserved message for every casing', async ({ request }) => {
    for (const name of ['admin', 'ADMIN', 'Admin', 'aDmIn', 'StyleFlo', 'style-flo']) {
      const response = await request.get(`/api/tenants/check-slug?name=${encodeURIComponent(name)}`)
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.available, name).toBe(false)
      expect(body.code).toBe('reserved')
      expect(body.message).toBe(RESERVED)
    }
  })

  test('register shows the reserved message for a reserved salon slug', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('e.g. StyleFlo Beauty Lounge').fill('StyleFlo')
    await expect(page.getByText(RESERVED)).toBeVisible()
  })

  test('check-name returns the exact block, review, emoji, and safe decisions', async ({ request }) => {
    const response = await request.post('/api/moderation/check-name', {
      data: {
        ownerName: 'Dickson',
        salonName: 'Fuck Cuts',
        slug: 'bloody-cuts',
        personaName: 'StyleFlo Support',
      },
    })
    expect(response.status()).toBe(200)
    const body = await response.json()
    const byField = Object.fromEntries(body.results.map((row: { field: string }) => [row.field, row]))
    expect(byField.ownerName).toMatchObject({ action: 'allow', message: null })
    expect(byField.salonName).toMatchObject({ action: 'block', message: BLOCK })
    expect(byField.slug).toMatchObject({ action: 'review', message: REVIEW })
    expect(byField.personaName).toMatchObject({ action: 'block', message: BLOCK })

    const emoji = await request.post('/api/moderation/check-name', {
      data: { salonName: 'Glamour 💇' },
    })
    const emojiBody = await emoji.json()
    expect(emojiBody.results[0]).toMatchObject({ action: 'emoji', message: EMOJI })
  })

  test('saves Scunthorpe, Cockburn, and Glamour Puss and blocks leetspeak and Cyrillic', async () => {
    const admin = adminClient()
    const safe = ['Scunthorpe Hair Co', 'Cockburn Beauty', 'Glamour Puss', 'Penistone', 'Hair Kuts']
    for (const company of safe) {
      const slug = `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${suffix()}`
      const { data, error } = await admin
        .from('tenants')
        .insert({ company_name: company, slug })
        .select('id, name_review_status')
        .single()
      expect(error, company).toBeNull()
      expect(data?.name_review_status).toBe('clear')
      await admin.from('tenants').delete().eq('id', data!.id)
    }

    for (const company of ['Tw@t Cuts', `Tw${'а'}t Cuts`, 'Fuuuuck Cuts']) {
      const slug = `blocked-${suffix()}`
      const { data, error } = await admin.from('tenants').insert({ company_name: company, slug }).select('id')
      expect(data).toBeNull()
      expect(`${error?.message || ''}`).toContain(BLOCK)
      const { data: rows } = await admin.from('tenants').select('id').eq('slug', slug)
      expect(rows).toEqual([])
    }
  })

  test('a severe owner name cannot create an account and a clean name can', async () => {
    const admin = adminClient()
    const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const badEmail = `banned-owner-${suffix()}@test.styleflo.ai`
    const bad = await admin.auth.admin.createUser({
      email: badEmail,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Fuck',
        company_name: 'Scunthorpe Hair Co',
        slug: `scunthorpe-owner-${suffix()}`,
      },
    })
    expect(bad.error).toBeTruthy()
    const badLogin = await anon.auth.signInWithPassword({ email: badEmail, password: 'Password123!' })
    expect(badLogin.error).toBeTruthy()

    const goodEmail = `safe-owner-${suffix()}@test.styleflo.ai`
    const goodSlug = `dickson-studio-${suffix()}`
    const good = await admin.auth.admin.createUser({
      email: goodEmail,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Alex Dickson',
        company_name: 'Dickson Studio',
        slug: goodSlug,
      },
    })
    expect(good.error).toBeNull()
    const { data: tenant } = await admin.from('tenants').select('id, company_name').eq('slug', goodSlug).single()
    expect(tenant?.company_name).toBe('Dickson Studio')
    if (good.data.user) await admin.auth.admin.deleteUser(good.data.user.id)
    if (tenant?.id) await admin.from('tenants').delete().eq('id', tenant.id)
  })

  test('review-tier salon is saved pending and the page stays unpublished', async ({ request }) => {
    const admin = adminClient()
    const email = `review-salon-${suffix()}@test.styleflo.ai`
    const slug = `penistone-review-${suffix()}`
    const created = await admin.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Pat Hancock',
        company_name: 'Penistone Studio',
        slug,
      },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id
    const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')
    const login = await anon.auth.signInWithPassword({ email, password: 'Password123!' })
    expect(login.error).toBeNull()
    const { data: tenant } = await admin.from('tenants').select('id').eq('slug', slug).single()

    const published = await request.post('/api/tenants/publish-page', {
      headers: { Authorization: `Bearer ${login.data.session!.access_token}` },
      data: { tenantId: tenant!.id, businessName: 'Bloody Cuts' },
    })
    expect(published.status()).toBe(200)
    const body = await published.json()
    expect(body.nameReview).toMatchObject({ action: 'review', message: REVIEW })
    expect(body.wordpressPublished).toBe(false)

    const { data: saved } = await admin
      .from('tenants')
      .select('company_name, name_review_status, page_published')
      .eq('id', tenant!.id)
      .single()
    expect(saved).toMatchObject({
      company_name: 'Bloody Cuts',
      name_review_status: 'pending',
      page_published: false,
    })

    await admin.auth.admin.deleteUser(userId)
    await admin.from('tenants').delete().eq('id', tenant!.id)
  })

  test('persona names StyleFlo Support and a block term are rejected and not stored', async ({ request }) => {
    const session = await createTestUser({ tenantId: ACME, role: 'owner' })
    try {
      for (const name of ['StyleFlo Support', 'Twat']) {
        const id = crypto.randomUUID()
        const response = await request.post('/api/chatbots', {
          headers: { Authorization: `Bearer ${session.token}` },
          data: {
            id,
            tenant_id: ACME,
            name,
            primary_color: '#4F46E5',
            voice_enabled: false,
            configuration_json: { agent_name: name },
          },
        })
        expect(response.status(), name).toBe(400)
        const body = await response.json()
        expect(body.error).toBe(BLOCK)
        const { data } = await adminClient().from('chatbots').select('id').eq('id', id)
        expect(data).toEqual([])
      }
    } finally {
      await session.cleanup()
    }
  })

  test('a direct service-role insert of a banned salon is a 4xx-class error and writes no row', async () => {
    const admin = adminClient()
    const slug = `direct-ban-${suffix()}`
    const { data, error, status } = await admin
      .from('tenants')
      .insert({ company_name: 'Fuck Cuts', slug })
      .select('id')
    expect(data).toBeNull()
    expect(error).toBeTruthy()
    expect(status).toBeGreaterThanOrEqual(400)
    expect(error?.message || '').toContain(BLOCK)
    const { data: rows } = await admin.from('tenants').select('id').eq('slug', slug)
    expect(rows).toEqual([])
  })

  test('superadmin allow then deny takes effect on the next check', async ({ request }) => {
    const superadmin = await createTestSuperadminUser()
    const admin = adminClient()
    const allowedSlug = `twat-allowed-${suffix()}`
    try {
      const allow = await request.post('/api/superadmin/moderation-terms', {
        headers: { Authorization: `Bearer ${superadmin.token}` },
        data: { term: 'twat', kind: 'profanity', action: 'allow', note: 'STYL-225 allow' },
      })
      expect(allow.status()).toBe(200)

      const { data: saved, error } = await admin
        .from('tenants')
        .insert({ company_name: 'Twat Barbers', slug: allowedSlug })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(saved?.id).toBeTruthy()
      await admin.from('tenants').delete().eq('id', saved!.id)

      const deny = await request.post('/api/superadmin/moderation-terms', {
        headers: { Authorization: `Bearer ${superadmin.token}` },
        data: { term: 'testbanword', kind: 'profanity', action: 'block', note: 'STYL-225 deny' },
      })
      expect(deny.status()).toBe(200)

      const checked = await request.post('/api/moderation/check-name', {
        data: { salonName: 'Testbanword Salon' },
      })
      const checkedBody = await checked.json()
      expect(checkedBody.results[0]).toMatchObject({ action: 'block', message: BLOCK })

      const bannedSlug = `testbanword-${suffix()}`
      const { error: bannedError } = await admin
        .from('tenants')
        .insert({ company_name: 'Testbanword Salon', slug: bannedSlug })
      expect(bannedError?.message || '').toContain(BLOCK)
      const { data: bannedRows } = await admin.from('tenants').select('id').eq('slug', bannedSlug)
      expect(bannedRows).toEqual([])
    } finally {
      await admin.from('moderation_terms').delete().eq('term', 'testbanword').eq('source', 'superadmin')
      await admin
        .from('moderation_terms')
        .update({ action: 'block', severity: 3, source: 'seed', note: null })
        .eq('term', 'twat')
        .eq('kind', 'profanity')
      await superadmin.cleanup()
    }
  })

  test('a mild swear in visitor chat is stored and flagged, not blocked', async () => {
    const admin = adminClient()
    const text = `this is bloody annoying ${suffix()}`
    const { data, error } = await admin
      .from('messages')
      .insert({
        tenant_id: ACME,
        conversation_id: CONVERSATION,
        sender_type: 'user',
        text_content: text,
      })
      .select('id, text_content')
      .single()
    expect(error).toBeNull()
    expect(data?.text_content).toBe(text)

    const { data: events } = await admin
      .from('moderation_events')
      .select('action, context')
      .eq('value_text', text)
    expect(events).toEqual([expect.objectContaining({ action: 'flag', context: 'chat' })])
    await admin.from('messages').delete().eq('id', data!.id)
  })

  test('slug suggestions omit a suffix a superadmin has reserved', async ({ request }) => {
    const superadmin = await createTestSuperadminUser()
    const admin = adminClient()
    const baseSlug = `suggest${Date.now()}`
    const blocked = `${baseSlug}-official`
    const storedTerm = blocked.replace(/[^a-z0-9]/g, '')
    try {
      const { error } = await admin.from('tenants').insert({
        company_name: 'Suggest Salon',
        slug: baseSlug,
      })
      expect(error).toBeNull()
      const reserved = await request.post('/api/superadmin/moderation-terms', {
        headers: { Authorization: `Bearer ${superadmin.token}` },
        data: { term: blocked, kind: 'reserved', action: 'reserved' },
      })
      expect(reserved.status()).toBe(200)
      const response = await request.get(`/api/tenants/check-slug?name=${encodeURIComponent(baseSlug)}`)
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.available).toBe(false)
      expect(body.suggestions).not.toContain(blocked)
      expect(body.suggestions.length).toBeGreaterThan(0)
    } finally {
      await admin.from('moderation_terms').delete().eq('term', storedTerm).eq('kind', 'reserved')
      await admin.from('tenants').delete().eq('slug', baseSlug)
      await superadmin.cleanup()
    }
  })

  test('a saved review-tier persona keeps the review message on screen', async ({ page }) => {
    test.setTimeout(90000)
    const admin = adminClient()
    const email = `persona-review-${suffix()}@test.styleflo.ai`
    const slug = `persona-review-${suffix()}`
    const created = await admin.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Pat Hancock',
        company_name: 'Penistone Studio',
        slug,
      },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id
    const { data: tenant } = await admin.from('tenants').select('id').eq('slug', slug).single()
    try {
      await page.goto('/login')
      await page.locator('input[type="email"]').fill(email)
      await page.locator('input[type="password"]').fill('Password123!')
      await page.locator('form button[type="submit"]').click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 })
      await expect(page.getByRole('heading', { name: 'Create New Chatbot' })).toBeVisible()
      await page.getByPlaceholder('e.g. FloChat Assistant').fill('Bloody')
      const review = page.getByText(REVIEW)
      const finish = page.getByRole('button', { name: 'Finish & Launch Chatbot' })
      const next = page.getByRole('button', { name: 'Next Step', exact: true })
      for (let step = 0; step < 4; step++) {
        if (await review.isVisible().catch(() => false)) break
        if (await finish.isVisible().catch(() => false)) {
          await finish.click()
          break
        }
        try {
          await next.click({ timeout: 3000 })
        } catch {
          break
        }
      }
      await expect(review).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Create New Chatbot' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Bloody', level: 4 })).toBeVisible()
      await page.getByRole('button', { name: 'Edit Agent' }).click()
      await page.getByPlaceholder('e.g. FloChat Assistant').fill('Emma')
      await page.getByRole('button', { name: '2 Persona' }).click()
      await page.getByLabel('Agent Display Name').fill('Emma')
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await expect(page.getByRole('heading', { name: 'Emma', level: 4 })).toBeVisible()
      await expect(page.getByText(REVIEW)).toHaveCount(0)
    } finally {
      if (tenant?.id) {
        await admin.from('chatbots').delete().eq('tenant_id', tenant.id)
        await admin.from('tenants').delete().eq('id', tenant.id)
      }
      await admin.auth.admin.deleteUser(userId)
    }
  })

  test('the house tenant can keep slug styleflo and its StyleFlo chatbots', async ({ request }) => {
    const admin = adminClient()
    const safeSlug = `house-safe-${suffix()}`
    const { data: created, error: createError } = await admin
      .from('tenants')
      .insert({ company_name: 'Penistone Studio', slug: safeSlug })
      .select('id')
      .single()
    expect(createError).toBeNull()
    const houseId = created!.id
    const otherSlug = `house-other-${suffix()}`
    const { data: other, error: otherError } = await admin
      .from('tenants')
      .insert({ company_name: 'Cockburn Beauty', slug: otherSlug })
      .select('id')
      .single()
    expect(otherError).toBeNull()
    const otherId = other!.id
    const botId = crypto.randomUUID()
    const session = await createTestUser({ tenantId: houseId, role: 'owner' })
    try {
      const { error: allowError } = await admin.from('moderation_house_allowlist').insert({
        tenant_id: houseId,
        note: 'test house tenant',
      })
      expect(allowError).toBeNull()

      const { error: slugError } = await admin
        .from('tenants')
        .update({ slug: 'styleflo', company_name: 'StyleFlo' })
        .eq('id', houseId)
      expect(slugError).toBeNull()

      const { error: botError } = await admin.from('chatbots').insert({
        id: botId,
        tenant_id: houseId,
        name: 'StyleFlo Support',
        configuration_json: { agent_name: 'StyleFlo Homepage Assistant' },
      })
      expect(botError).toBeNull()

      const { error: editError } = await admin
        .from('chatbots')
        .update({
          name: 'StyleFlo Homepage Assistant',
          configuration_json: { agent_name: 'StyleFlo Support' },
        })
        .eq('id', botId)
      expect(editError).toBeNull()

      const { error: swearError } = await admin
        .from('chatbots')
        .update({ name: 'Twat' })
        .eq('id', botId)
      expect(swearError?.message || '').toContain(BLOCK)

      const { error: stolenSlug } = await admin
        .from('tenants')
        .update({ slug: 'styleflo' })
        .eq('id', otherId)
      expect(stolenSlug?.message || '').toContain(RESERVED)

      const { error: stolenBot } = await admin.from('chatbots').insert({
        id: crypto.randomUUID(),
        tenant_id: otherId,
        name: 'StyleFlo Support',
        configuration_json: { agent_name: 'StyleFlo Homepage Assistant' },
      })
      expect(stolenBot?.message || '').toContain(BLOCK)

      const createdBot = await request.post('/api/chatbots', {
        headers: { Authorization: `Bearer ${session.token}` },
        data: {
          id: crypto.randomUUID(),
          tenant_id: houseId,
          name: 'StyleFlo Support',
          primary_color: '#4F46E5',
          voice_enabled: false,
          configuration_json: { agent_name: 'StyleFlo Homepage Assistant' },
        },
      })
      expect(createdBot.status()).toBe(200)

      const editedBot = await request.patch(`/api/chatbots/${botId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
        data: {
          name: 'StyleFlo Support',
          configuration_json: { agent_name: 'StyleFlo Homepage Assistant' },
        },
      })
      expect(editedBot.status()).toBe(200)
    } finally {
      await session.cleanup()
      await admin.from('chatbots').delete().eq('tenant_id', houseId)
      await admin.from('chatbots').delete().eq('tenant_id', otherId)
      await admin.from('moderation_house_allowlist').delete().eq('tenant_id', houseId)
      await admin.from('tenants').delete().eq('id', houseId)
      await admin.from('tenants').delete().eq('id', otherId)
    }
  })

  test('a moderation failure cannot block a visitor message', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261122153000_styl412_staff_token_grants.sql'),
      'utf8',
    )
    expect(source).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(source).toContain('RETURN NEW')
  })

  test('slugs of 1 or 2 characters are rejected and a 3 character slug is allowed', async ({ page, request }) => {
    for (const name of ['a', 'ab']) {
      const response = await request.get(`/api/tenants/check-slug?name=${encodeURIComponent(name)}`)
      expect(response.status(), name).toBe(400)
      const body = await response.json()
      expect(body.available, name).toBe(false)
      expect(body.code).toBe('tooShort')
      expect(body.message).toBe(TOO_SHORT)
      expect(body.slug).toBe(name)
    }

    const reservedShort = await request.get('/api/tenants/check-slug?name=ad')
    expect(reservedShort.status()).toBe(200)
    const reservedBody = await reservedShort.json()
    expect(reservedBody.available).toBe(false)
    expect(reservedBody.code).toBe('reserved')
    expect(reservedBody.message).toBe(RESERVED)

    const three = await request.get('/api/tenants/check-slug?name=k9q')
    expect(three.status()).toBe(200)
    const threeBody = await three.json()
    expect(threeBody.slug).toBe('k9q')
    expect(threeBody.message).toBeUndefined()
    expect(threeBody.available).toBe(true)

    for (const slug of ['a', 'ab']) {
      const checked = await request.post('/api/moderation/check-name', { data: { slug } })
      expect(checked.status(), slug).toBe(200)
      const body = await checked.json()
      expect(body.results[0], slug).toMatchObject({ field: 'slug', action: 'tooShort', message: TOO_SHORT })
    }
    const checkedThree = await request.post('/api/moderation/check-name', { data: { slug: 'k9q' } })
    expect(checkedThree.status()).toBe(200)
    const checkedThreeBody = await checkedThree.json()
    expect(checkedThreeBody.results[0]).toMatchObject({ action: 'allow', message: null })

    const admin = adminClient()
    for (const slug of ['a', 'ab']) {
      const { data, error, status } = await admin
        .from('tenants')
        .insert({ company_name: 'Penistone Studio', slug })
        .select('id')
      expect(data, slug).toBeNull()
      expect(error, slug).toBeTruthy()
      expect(status, slug).toBeGreaterThanOrEqual(400)
      expect(error?.message || '', slug).toContain(TOO_SHORT)
      const { data: rows } = await admin.from('tenants').select('id').eq('slug', slug)
      expect(rows, slug).toEqual([])
    }

    const { data: saved, error: savedError } = await admin
      .from('tenants')
      .insert({ company_name: 'Penistone Studio', slug: 'k9q' })
      .select('id, slug, name_review_status')
      .single()
    expect(savedError).toBeNull()
    expect(saved).toMatchObject({ slug: 'k9q', name_review_status: 'clear' })
    if (saved?.id) await admin.from('tenants').delete().eq('id', saved.id)

    await page.goto('/register')
    await page.getByPlaceholder('e.g. StyleFlo Beauty Lounge').fill('AB')
    await expect(page.getByText(TOO_SHORT)).toBeVisible()
  })

  test('company name AB at sign-up gets a padded slug', async () => {
    const admin = adminClient()
    const email = `short-salon-${suffix()}@test.styleflo.ai`
    const created = await admin.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'Alex Dickson',
        company_name: 'AB',
      },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id
    try {
      const { data: profile } = await admin.from('profiles').select('tenant_id').eq('id', userId).single()
      const { data: tenant } = await admin
        .from('tenants')
        .select('id, company_name, slug')
        .eq('id', profile!.tenant_id)
        .single()
      expect(tenant?.company_name).toBe('AB')
      expect(tenant?.slug).toMatch(/^ab-\d+$/)
      expect((tenant?.slug || '').replace(/[^a-z0-9]/g, '').length).toBeGreaterThanOrEqual(3)
      if (tenant?.id) await admin.from('tenants').delete().eq('id', tenant.id)
    } finally {
      await admin.auth.admin.deleteUser(userId)
    }
  })

  test('a tenant update that changes neither name nor slug does not re-run moderation', async () => {
    const admin = adminClient()
    const slug = `early-return-${suffix()}`
    const { data, error } = await admin
      .from('tenants')
      .insert({ company_name: 'Bloody Cuts', slug })
      .select('id, name_review_status')
      .single()
    expect(error).toBeNull()
    const tenantId = data!.id
    try {
      expect(data?.name_review_status).toBe('pending')
      const { count: before } = await admin
        .from('moderation_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      const domain = `early-${suffix()}.example`
      const { error: updateError } = await admin.from('tenants').update({ domain }).eq('id', tenantId)
      expect(updateError).toBeNull()
      const { data: saved } = await admin
        .from('tenants')
        .select('domain, company_name, slug, name_review_status')
        .eq('id', tenantId)
        .single()
      expect(saved).toMatchObject({
        domain,
        company_name: 'Bloody Cuts',
        slug,
        name_review_status: 'pending',
      })
      const { count: after } = await admin
        .from('moderation_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      expect(after).toBe(before)
    } finally {
      await admin.from('tenants').delete().eq('id', tenantId)
    }
  })

  test('a normal member cannot write the moderation list', async ({ request }) => {
    const member = await createTestUser({ role: 'member' })
    try {
      const response = await request.post('/api/superadmin/moderation-terms', {
        headers: { Authorization: `Bearer ${member.token}` },
        data: { term: 'nope', kind: 'profanity', action: 'block' },
      })
      expect(response.status()).toBe(403)
    } finally {
      await member.cleanup()
    }
  })
})
