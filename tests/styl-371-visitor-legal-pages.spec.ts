import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { proxy } from '../src/proxy'
import { visitorLegalPagesEnabled } from '../src/lib/legal/visitor-legal-flag'
import { loadVisitorLegalPage } from '../src/lib/legal/load-visitor-legal-page'
import {
  renderVisitorLegal,
  transcriptRetentionPhrase,
  VISITOR_LEGAL_DRAFT_BANNER,
  type VisitorLegalFacts,
} from '../src/lib/legal/render-visitor-legal'
import { VISITOR_PRIVACY_VERSION } from '../src/lib/legal/visitor-templates/privacy'
import { VISITOR_TERMS_VERSION } from '../src/lib/legal/visitor-templates/terms'
import { REMOVE_STYLEFLO_BRANDING_ADDON_ID } from '../src/lib/billing/branding'

/**
 * STYL-371. Shared visitor terms and privacy pages, off unless the flag is
 * exactly `true`. Local Supabase only. The widget is not given these links.
 */

const root = process.cwd()
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const FLAG = 'VISITOR_LEGAL_PAGES_ENABLED'

function service(): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function localSupabase(): void {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').toLowerCase()
  expect(url.includes('127.0.0.1') || url.includes('localhost')).toBe(true)
  expect(url.includes('tkoasyjvrgaglofpzduq')).toBe(false)
  expect(url.includes('lriugykhrfnnouexqqhm')).toBe(false)
}

function facts(overrides: Partial<VisitorLegalFacts> = {}): VisitorLegalFacts {
  return {
    slug: 'harbour-salon',
    companyName: 'Harbour Salon',
    registeredCompany: false,
    companyRegistrationNumber: null,
    tradingStreet: null,
    tradingCity: null,
    tradingPostcode: null,
    tradingPhone: null,
    registeredStreet: null,
    registeredCity: null,
    registeredPostcode: null,
    messageRetentionDays: 90,
    agentName: null,
    voiceEnabled: false,
    phoneEnabled: false,
    smsEnabled: false,
    clinic: false,
    hideBranding: false,
    publicContactEmail: null,
    businessPrivacyUrl: null,
    marketingEnabled: false,
    ...overrides,
  }
}

function expectNoTokens(html: string): void {
  expect(html).not.toContain('{{')
  expect(html).not.toContain('}}')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

test.describe('STYL-371 visitor legal pages', () => {
  const previousFlag = process.env[FLAG]

  test.afterEach(() => {
    if (previousFlag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = previousFlag
  })

  test('only the exact string true enables the pages', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1', ' true', 'true ']) {
      if (value === undefined) delete process.env[FLAG]
      else process.env[FLAG] = value
      expect(visitorLegalPagesEnabled()).toBe(false)
      const loaded = await loadVisitorLegalPage({ kind: 'terms', slug: 'harbour-salon' })
      expect(loaded.ok).toBe(false)
    }
    process.env[FLAG] = 'true'
    expect(visitorLegalPagesEnabled()).toBe(true)
  })

  test('a filled business renders both pages with the draft banner and no tokens', () => {
    const filled = facts({
      registeredCompany: true,
      companyRegistrationNumber: '17459399',
      tradingStreet: '1 Jamaica Street',
      tradingCity: 'Liverpool',
      tradingPostcode: 'L1 0AH',
      tradingPhone: '0151 000 0000',
      agentName: 'Nora',
      voiceEnabled: true,
      publicContactEmail: 'hello@harbour.example',
    })
    for (const kind of ['terms', 'privacy'] as const) {
      const document = renderVisitorLegal(kind, filled)
      expect(document.status).toBe('DRAFT')
      expect(document.banner).toBe(VISITOR_LEGAL_DRAFT_BANNER)
      expect(document.html).toContain('Harbour Salon')
      expect(document.html).toContain('1 Jamaica Street, Liverpool, L1 0AH')
      expect(document.html).toContain('0151 000 0000')
      expect(document.html).toContain('17459399')
      if (kind === 'terms') expect(document.html).toContain('Nora')
      expect(document.html).toContain('1.0-draft')
      expect(document.html).toContain('1 November 2026')
      expect(document.html).toContain('hello@harbour.example')
      expectNoTokens(document.html)
    }
    const banner = readFileSync(join(root, 'src/app/v/visitor-legal-document.tsx'), 'utf8')
    expect(banner).toContain('visitor-legal-draft-banner')
    expect(banner).toContain('document.banner')
  })

  test('blank name, address, phone and company number use the fallbacks', () => {
    const document = renderVisitorLegal('terms', facts({
      companyName: '   ',
      registeredCompany: true,
      companyRegistrationNumber: '   ',
    }))
    expect(document.html).toContain('the business whose website you are on')
    expect(document.html).not.toContain('Address:')
    expect(document.html).not.toContain('company number )')
    expect(document.html).toContain('company number 17459342')
    expect(document.html).toContain('support@styleflo.ai')
    expect(document.html).toContain("we'll pass your message on")
    expect(document.html).toContain('the AI assistant')
    expectNoTokens(document.html)

    const registeredOnly = renderVisitorLegal('privacy', facts({
      tradingStreet: null,
      registeredStreet: '49 Jamaica St',
      registeredCity: 'Liverpool',
      registeredPostcode: 'L1 0AH',
    }))
    expect(registeredOnly.html).toContain('49 Jamaica St, Liverpool, L1 0AH')
    expectNoTokens(registeredOnly.html)
  })

  test('a hostile business name is escaped on the page', () => {
    const document = renderVisitorLegal('terms', facts({
      companyName: '<script>alert(1)</script> & Co',
      tradingStreet: '<img src=x onerror=alert(1)>',
    }))
    expect(document.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co')
    expect(document.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(document.html).not.toContain('<script')
    expect(document.html).not.toContain('<img')
    expectNoTokens(document.html)
  })

  test('voice, phone, text, clinic and marketing sections follow the flags', () => {
    const quiet = renderVisitorLegal('terms', facts())
    expect(quiet.html).not.toContain('Voice conversations')
    expect(quiet.html).not.toContain('and phone line')
    expect(quiet.html).not.toContain('and text number')
    expect(quiet.html).not.toContain('2A. Health')

    const voiced = renderVisitorLegal('terms', facts({
      voiceEnabled: true,
      phoneEnabled: true,
      smsEnabled: true,
      clinic: true,
    }))
    expect(voiced.html).toContain('Voice conversations')
    expect(voiced.html).toContain("aren't recorded")
    expect(voiced.html).toContain('and calls')
    expect(voiced.html).toContain('and phone line')
    expect(voiced.html).toContain('and text number')
    expect(voiced.html).toContain('2A. Health and treatments')
    expectNoTokens(voiced.html)

    const privacyQuiet = renderVisitorLegal('privacy', facts())
    expect(privacyQuiet.html).not.toContain('Call details')
    expect(privacyQuiet.html).not.toContain('or by text')
    expect(privacyQuiet.html).not.toContain('3A. Health')
    expect(privacyQuiet.html).not.toContain('To send you marketing')
    expect(privacyQuiet.html).not.toContain('[TBC]')
    expect(privacyQuiet.html).toContain('Sub-processor list [link to be confirmed]')
    expect(privacyQuiet.html).toContain('[Placeholder: TBC from the sub-processor list (Privacy Part D, DPA 7)]')

    const privacyOn = renderVisitorLegal('privacy', facts({
      voiceEnabled: true,
      phoneEnabled: true,
      smsEnabled: true,
      clinic: true,
      marketingEnabled: true,
      messageRetentionDays: 30,
    }))
    expect(privacyOn.html).toContain('Call details')
    expect(privacyOn.html).toContain('or by text')
    expect(privacyOn.html).toContain('3A. Health information')
    expect(privacyOn.html).toContain('[TBC]')
    expect(privacyOn.html).toContain('To send you marketing')
    expect(privacyOn.html).toContain('30 days')
    expect(privacyOn.html).not.toContain('30 days days')
    expectNoTokens(privacyOn.html)
  })

  test('visitor pages do not show reviewer notes', () => {
    const banned = [
      'Solicitor',
      'awaiting Stuart',
      'PROPOSED',
      'W4',
      'DPA 2.',
      'Anti-Gravity',
    ]
    const pages = [
      renderVisitorLegal('terms', facts()),
      renderVisitorLegal('privacy', facts()),
      renderVisitorLegal('terms', facts({
        voiceEnabled: true,
        phoneEnabled: true,
        smsEnabled: true,
        clinic: true,
        marketingEnabled: true,
      })),
      renderVisitorLegal('privacy', facts({
        voiceEnabled: true,
        phoneEnabled: true,
        smsEnabled: true,
        clinic: true,
        marketingEnabled: true,
      })),
    ]
    for (const page of pages) {
      const visible = `${VISITOR_LEGAL_DRAFT_BANNER}\n${page.html}`
      for (const phrase of banned) {
        expect(visible, phrase).not.toContain(phrase)
      }
    }
  })

  test('removing StyleFlo branding never hides the AI label, the notice or the links', () => {
    for (const kind of ['terms', 'privacy'] as const) {
      const shown = renderVisitorLegal(kind, facts({ hideBranding: false, voiceEnabled: true }))
      const hidden = renderVisitorLegal(kind, facts({ hideBranding: true, voiceEnabled: true }))
      expect(hidden.html).toBe(shown.html)
      expect(hidden.html).toContain('AI assistant')
      expect(hidden.html).toContain('StyleFlo')
      expectNoTokens(hidden.html)
    }
    const terms = renderVisitorLegal('terms', facts({ hideBranding: true }))
    const privacy = renderVisitorLegal('privacy', facts({ hideBranding: true }))
    expect(terms.html).toContain('Privacy notice for this assistant')
    expect(terms.html).toContain('/v/harbour-salon/privacy')
    expect(privacy.html).toContain('terms of use')
    expect(privacy.html).toContain('/v/harbour-salon/terms')
    expect(privacy.html).toContain('https://styleflo.ai/privacy/#assistant')
  })

  test('retention phrases use 12 months, 90 days, or the shortened number', () => {
    expect(transcriptRetentionPhrase(365)).toBe('12 months')
    expect(transcriptRetentionPhrase(90)).toBe('90 days')
    expect(transcriptRetentionPhrase(14)).toBe('14 days')
    const year = renderVisitorLegal('privacy', facts({ messageRetentionDays: 365 }))
    expect(year.html).toContain('12 months')
    expect(year.html).not.toContain('12 months days')
    const clinicDefault = renderVisitorLegal('privacy', facts({
      clinic: true,
      messageRetentionDays: null,
    }))
    expect(clinicDefault.html).toContain('90 days')
  })

  test('old versions and unknown slugs are refused when the flag is on', async () => {
    localSupabase()
    process.env[FLAG] = 'true'
    const unknown = await loadVisitorLegalPage({ kind: 'terms', slug: 'no-such-salon-371' })
    expect(unknown.ok).toBe(false)
    const odd = await loadVisitorLegalPage({ kind: 'privacy', slug: '../secrets' })
    expect(odd.ok).toBe(false)
    const old = await loadVisitorLegalPage({
      kind: 'terms',
      slug: 'harbour-salon',
      version: '0.1',
    })
    expect(old.ok).toBe(false)
    expect(VISITOR_TERMS_VERSION).toBe('1.0-draft')
    expect(VISITOR_PRIVACY_VERSION).toBe('1.0-draft')
  })

  test('the public path is not sent to the dashboard', async () => {
    const response = await proxy(new NextRequest('http://localhost:3001/v/harbour-salon/terms'))
    expect(response.headers.get('location')).toBeNull()
    const source = readFileSync(join(root, 'src/proxy.ts'), 'utf8')
    expect(source).toContain("pathname.startsWith('/v/')")
    expect(source).not.toMatch(/wordpress-api|wordpress-publish|wp-json/)
  })

  test('widget files stay on the platform links and do not mention visitor legal urls', () => {
    const widgetFiles = [
      'src/widget/embed.ts',
      'src/widget/index.ts',
      'public/widget.js',
      'public/embed.js',
    ]
    for (const rel of widgetFiles) {
      const source = readFileSync(join(root, rel), 'utf8')
      expect(source, rel).toContain('https://styleflo.ai/terms-conditions/')
      expect(source, rel).toContain('https://styleflo.ai/privacy/')
      expect(source, rel).not.toContain('termsUrl')
      expect(source, rel).not.toContain('privacyUrl')
      expect(source, rel).not.toMatch(/\/v\/[A-Za-z0-9-]+\/(?:terms|privacy)/)
    }
    const route = readFileSync(join(root, 'src/app/api/chatbots/[id]/route.ts'), 'utf8')
    expect(route).not.toContain('termsUrl')
    expect(route).not.toContain('privacyUrl')
    expect(route).not.toContain('VISITOR_LEGAL_PAGES_ENABLED')
  })

  test('legal files cannot publish to WordPress and the flag is not a token', () => {
    const files = [
      ...walk(join(root, 'src/lib/legal')),
      ...walk(join(root, 'src/app/v')),
    ]
    for (const path of files) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/wordpress-api|wordpress-publish/)
      expect(source, path).not.toMatch(/wp-json|WORDPRESS_SITE_URL|STYLEFLO_WP_/)
      expect(source, path).not.toMatch(/\bfetch\s*\(/)
    }
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    expect(example).toContain('VISITOR_LEGAL_PAGES_ENABLED=false')
    expect(example).not.toContain('VISITOR_LEGAL_PAGES_ENABLED=true')
    for (const rel of ['apphosting.yaml', 'apphosting.staging.yaml']) {
      expect(readFileSync(join(root, rel), 'utf8')).not.toContain('VISITOR_LEGAL_PAGES_ENABLED')
    }
    const loader = readFileSync(join(root, 'src/lib/legal/load-visitor-legal-page.ts'), 'utf8')
    expect(loader).not.toMatch(/stripe_customer_id|notification_email|api_key|service_role/)
  })
})

test.describe('STYL-371 visitor legal pages against local Supabase', () => {
  let admin: SupabaseClient
  let filledId = ''
  let blankId = ''
  let otherId = ''
  const filledSlug = `harbour-legal-${crypto.randomUUID().slice(0, 8)}`
  const blankSlug = `quiet-legal-${crypto.randomUUID().slice(0, 8)}`
  const otherSlug = `other-legal-${crypto.randomUUID().slice(0, 8)}`
  const otherName = `Other Salon ${crypto.randomUUID().slice(0, 8)}`
  const previousFlag = process.env[FLAG]

  test.beforeAll(async () => {
    localSupabase()
    admin = service()
    const filled = await admin.from('tenants').insert({
      company_name: 'Harbour Salon',
      slug: filledSlug,
      is_registered_company: true,
      company_registration_number: '17459399',
      trading_address_street: '1 Jamaica Street',
      trading_address_city: 'Liverpool',
      trading_address_postcode: 'L1 0AH',
      trading_address_phone: '0151 000 0000',
      has_landline: false,
      has_mobile: false,
    }).select('id').single()
    expect(filled.error).toBeNull()
    filledId = filled.data?.id || ''
    const bot = await admin.from('chatbots').insert({
      tenant_id: filledId,
      name: 'Harbour Assistant',
      voice_enabled: true,
      configuration_json: { agent_name: 'Nora' },
    })
    expect(bot.error).toBeNull()

    const blank = await admin.from('tenants').insert({
      company_name: 'Quiet Salon',
      slug: blankSlug,
      is_registered_company: false,
    }).select('id').single()
    expect(blank.error).toBeNull()
    blankId = blank.data?.id || ''

    const other = await admin.from('tenants').insert({
      company_name: otherName,
      slug: otherSlug,
    }).select('id').single()
    expect(other.error).toBeNull()
    otherId = other.data?.id || ''
  })

  test.afterAll(async () => {
    if (previousFlag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = previousFlag
    if (!admin) return
    const ids = [filledId, blankId, otherId].filter(Boolean)
    if (ids.length === 0) return
    await admin.from('chatbots').delete().in('tenant_id', ids)
    await admin.from('tenant_addon_inclusions').delete().in('tenant_id', ids)
    await admin.from('tenants').delete().in('id', ids)
  })

  test.afterEach(() => {
    if (previousFlag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = previousFlag
  })

  test('the seeded salon page shows its own details and nobody else\'s', async () => {
    process.env[FLAG] = 'true'
    const terms = await loadVisitorLegalPage({ kind: 'terms', slug: filledSlug })
    const privacy = await loadVisitorLegalPage({ kind: 'privacy', slug: filledSlug })
    expect(terms.ok).toBe(true)
    expect(privacy.ok).toBe(true)
    if (!terms.ok || !privacy.ok) return
    expect(terms.document.banner).toBe(VISITOR_LEGAL_DRAFT_BANNER)
    expect(terms.document.html).toContain('Harbour Salon')
    expect(terms.document.html).toContain('1 Jamaica Street, Liverpool, L1 0AH')
    expect(terms.document.html).toContain('0151 000 0000')
    expect(terms.document.html).toContain('Nora')
    expect(terms.document.html).toContain("aren't recorded")
    expect(privacy.document.html).toContain('90 days')
    for (const html of [terms.document.html, privacy.document.html]) {
      expect(html).not.toContain(filledId)
      expect(html).not.toContain(blankId)
      expect(html).not.toContain(otherId)
      expect(html).not.toContain(otherName)
      expectNoTokens(html)
    }
    const versioned = await loadVisitorLegalPage({
      kind: 'terms',
      slug: filledSlug,
      version: VISITOR_TERMS_VERSION,
    })
    expect(versioned.ok).toBe(true)
  })

  test('a salon with no address, phone or company number uses the fallback', async () => {
    process.env[FLAG] = 'true'
    const loaded = await loadVisitorLegalPage({ kind: 'terms', slug: blankSlug })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.document.html).toContain('Quiet Salon')
    expect(loaded.document.html).not.toContain('Address:')
    expect(loaded.document.html).not.toContain('Quiet Salon, company number')
    expect(loaded.document.html).toContain('company number 17459342')
    expect(loaded.document.html).toContain('support@styleflo.ai')
    expect(loaded.document.html).toContain("we'll pass your message on")
    expect(loaded.document.html).not.toContain('Voice conversations')
    expectNoTokens(loaded.document.html)
  })

  test('phone, text and the branding bolt-on change only the sections they should', async () => {
    process.env[FLAG] = 'true'
    const before = await loadVisitorLegalPage({ kind: 'privacy', slug: filledSlug })
    expect(before.ok).toBe(true)
    if (!before.ok) return
    const included = await admin.from('tenant_addon_inclusions').insert({
      tenant_id: filledId,
      addon_catalog_id: REMOVE_STYLEFLO_BRANDING_ADDON_ID,
      included: true,
    })
    expect(included.error).toBeNull()
    const branded = await loadVisitorLegalPage({ kind: 'privacy', slug: filledSlug })
    expect(branded.ok).toBe(true)
    if (!branded.ok) return
    expect(branded.document.html).toBe(before.document.html)
    expect(branded.document.html).toContain('AI assistant')
    expect(branded.document.html).toContain('terms of use')
    expect(branded.document.html).toContain('StyleFlo')

    const channels = await admin.from('tenants').update({
      has_landline: true,
      has_mobile: true,
      message_retention_days: 30,
    }).eq('id', filledId)
    expect(channels.error).toBeNull()
    const updated = await loadVisitorLegalPage({ kind: 'privacy', slug: filledSlug })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.document.html).toContain('Call details')
    expect(updated.document.html).toContain('or by text')
    expect(updated.document.html).toContain('30 days')
    expectNoTokens(updated.document.html)
  })
})

test.describe('STYL-371 visitor legal routes on the test server', () => {
  test('flag off returns 404 and the chatbot config has no legal urls', async ({ request }) => {
    const slug = 'harbour-salon'
    for (const path of [`/v/${slug}/terms`, `/v/${slug}/privacy`, `/v/${slug}/terms/1.0-draft`, '/v/not-a-salon/privacy']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      const body = await response.text()
      expect(body).not.toContain('Harbour Salon')
      expect(body).not.toContain('termsUrl')
    }
    const config = await request.get('/api/chatbots/e0000000-0000-0000-0000-000000000002')
    expect(config.status()).toBe(200)
    const json = await config.json()
    expect(json.termsUrl).toBeUndefined()
    expect(json.privacyUrl).toBeUndefined()
    expect(json.termsVersion).toBe('1.0')
  })
})
