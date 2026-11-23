/**
 * Loads one business's visitor terms or privacy page.
 * Selects only the columns the template fills in. The tenant id is used to
 * read the agent name and bolt-ons, and is never put on the page.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { tenantHidesStyleFloBranding, REMOVE_STYLEFLO_BRANDING_ADDON_ID } from '@/lib/billing/branding'
import { visitorLegalPagesEnabled } from '@/lib/legal/visitor-legal-flag'
import {
  renderVisitorLegal,
  type VisitorLegalDocument,
  type VisitorLegalFacts,
  type VisitorLegalKind,
} from '@/lib/legal/render-visitor-legal'
import { VISITOR_PRIVACY_VERSION } from '@/lib/legal/visitor-templates/privacy'
import { VISITOR_TERMS_VERSION } from '@/lib/legal/visitor-templates/terms'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TENANT_COLUMNS = [
  'id',
  'slug',
  'company_name',
  'is_registered_company',
  'company_registration_number',
  'trading_address_street',
  'trading_address_city',
  'trading_address_postcode',
  'trading_address_phone',
  'registered_address_street',
  'registered_address_city',
  'registered_address_postcode',
  'has_landline',
  'has_mobile',
  'message_retention_days',
].join(', ')

type TenantRow = {
  id: string
  slug: string
  company_name: string | null
  is_registered_company: boolean | null
  company_registration_number: string | null
  trading_address_street: string | null
  trading_address_city: string | null
  trading_address_postcode: string | null
  trading_address_phone: string | null
  registered_address_street: string | null
  registered_address_city: string | null
  registered_address_postcode: string | null
  has_landline: boolean | null
  has_mobile: boolean | null
  message_retention_days: number | null
}

export type LoadedVisitorLegal =
  | { ok: false }
  | { ok: true; document: VisitorLegalDocument }

function serviceClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function versionFor(kind: VisitorLegalKind): string {
  return kind === 'terms' ? VISITOR_TERMS_VERSION : VISITOR_PRIVACY_VERSION
}

function agentNameFromConfig(config: unknown): string {
  if (!config || typeof config !== 'object') return ''
  const record = config as Record<string, unknown>
  const named = record.agent_name ?? record.agentName
  return typeof named === 'string' ? named.trim() : ''
}

export async function loadVisitorLegalPage(input: {
  kind: VisitorLegalKind
  slug: string
  version?: string | null
}): Promise<LoadedVisitorLegal> {
  if (!visitorLegalPagesEnabled()) return { ok: false }

  const slug = (input.slug || '').trim().toLowerCase()
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false }

  const currentVersion = versionFor(input.kind)
  if (input.version && input.version !== currentVersion) return { ok: false }

  const admin = serviceClient()
  if (!admin) return { ok: false }

  const { data, error } = await admin
    .from('tenants')
    .select(TENANT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return { ok: false }
  const tenant = data as unknown as TenantRow

  const [{ data: chatbots }, { data: purchases }, { data: inclusions }] = await Promise.all([
    admin
      .from('chatbots')
      .select('voice_enabled, configuration_json, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: true }),
    admin
      .from('tenant_active_addons')
      .select('addon_catalog_id, is_active')
      .eq('tenant_id', tenant.id)
      .eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID),
    admin
      .from('tenant_addon_inclusions')
      .select('addon_catalog_id, included')
      .eq('tenant_id', tenant.id)
      .eq('addon_catalog_id', REMOVE_STYLEFLO_BRANDING_ADDON_ID),
  ])

  const bots = chatbots || []
  let agentName = ''
  for (const bot of bots) {
    const named = agentNameFromConfig(bot.configuration_json)
    if (named) agentName = named
  }
  const voiceEnabled = bots.some((bot) => bot.voice_enabled === true)
  const hideBranding = tenantHidesStyleFloBranding({
    purchases: (purchases || []).map((row) => ({
      addon_catalog_id: row.addon_catalog_id,
      is_active: row.is_active === true,
    })),
    inclusions: (inclusions || []).map((row) => ({
      addon_catalog_id: row.addon_catalog_id,
      included: row.included === true,
    })),
  })

  const facts: VisitorLegalFacts = {
    slug,
    companyName: tenant.company_name,
    registeredCompany: tenant.is_registered_company === true,
    companyRegistrationNumber: tenant.company_registration_number,
    tradingStreet: tenant.trading_address_street,
    tradingCity: tenant.trading_address_city,
    tradingPostcode: tenant.trading_address_postcode,
    tradingPhone: tenant.trading_address_phone,
    registeredStreet: tenant.registered_address_street,
    registeredCity: tenant.registered_address_city,
    registeredPostcode: tenant.registered_address_postcode,
    messageRetentionDays: tenant.message_retention_days,
    agentName,
    voiceEnabled,
    phoneEnabled: tenant.has_landline === true,
    smsEnabled: tenant.has_mobile === true,
    // There is no clinic classification column yet, so the standard text is used.
    clinic: false,
    hideBranding,
    // No public contact email or business privacy URL column yet.
    publicContactEmail: null,
    businessPrivacyUrl: null,
    marketingEnabled: false,
  }

  return { ok: true, document: renderVisitorLegal(input.kind, facts) }
}
