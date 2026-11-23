/**
 * Fills the shared visitor terms and privacy templates.
 * Business-supplied text is HTML-escaped. Unfilled {{...}} never reaches the page.
 * Blank values follow the solicitor fallbacks: name, address, phone, then the
 * support@styleflo.ai relay line. There is no public contact email column yet.
 */

import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url'
import {
  VISITOR_PRIVACY_BODY,
  VISITOR_PRIVACY_EFFECTIVE_DATE,
  VISITOR_PRIVACY_STATUS,
  VISITOR_PRIVACY_VERSION,
} from '@/lib/legal/visitor-templates/privacy'
import {
  VISITOR_TERMS_BODY,
  VISITOR_TERMS_EFFECTIVE_DATE,
  VISITOR_TERMS_STATUS,
  VISITOR_TERMS_VERSION,
} from '@/lib/legal/visitor-templates/terms'

export const VISITOR_LEGAL_DRAFT_BANNER =
  'DRAFT, not legal advice, not yet checked by a solicitor'

export const BLANK_BUSINESS_NAME = 'the business whose website you are on'
export const BLANK_AGENT_NAME = 'the AI assistant'
export const STYLEFLO_PRIVACY_URL = 'https://styleflo.ai/privacy/#assistant'
export const TRANSFERS_SUMMARY_FALLBACK =
  '[Placeholder: TBC from the sub-processor list (Privacy Part D, DPA 7)]'
export const SPECIAL_CATEGORY_BASIS_FALLBACK = '[TBC]'

const CONTACT_LINE =
  'Contact: {{business_contact_email}}{{#if business_phone}} · {{business_phone}}{{/if}}.'
const SUBPROCESSOR_LINK = '[Sub-processor list]({{subprocessor_list_url}})'
const RETENTION_TOKEN = '{{transcript_retention_days}} days'

export type VisitorLegalKind = 'terms' | 'privacy'

export type VisitorLegalFacts = {
  slug: string
  companyName: string | null
  registeredCompany: boolean
  companyRegistrationNumber: string | null
  tradingStreet: string | null
  tradingCity: string | null
  tradingPostcode: string | null
  tradingPhone: string | null
  registeredStreet: string | null
  registeredCity: string | null
  registeredPostcode: string | null
  messageRetentionDays: number | null
  agentName: string | null
  voiceEnabled: boolean
  phoneEnabled: boolean
  smsEnabled: boolean
  clinic: boolean
  hideBranding: boolean
  publicContactEmail: string | null
  businessPrivacyUrl: string | null
  marketingEnabled: boolean
}

export type VisitorLegalDocument = {
  kind: VisitorLegalKind
  status: 'DRAFT'
  version: string
  effectiveDate: string
  title: string
  banner: string
  html: string
}

type Bag = Record<string, string | boolean>

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeBusiness(value: string): string {
  return escapeHtml(value).replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
}

export function transcriptRetentionPhrase(days: number): string {
  if (days === 365) return '12 months'
  if (days === 90) return '90 days'
  if (!Number.isInteger(days) || days < 1) return '12 months'
  return `${days} days`
}

function clean(value: string | null | undefined): string {
  return (value || '').trim()
}

function joinAddress(
  street: string | null,
  city: string | null,
  postcode: string | null,
): string {
  return [street, city, postcode].map((part) => clean(part)).filter(Boolean).join(', ')
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isOn(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

function applyConditionals(source: string, bag: Bag): string {
  let output = source
  const block = /\{\{#(if|unless) ([a-z0-9_]+)\}\}((?:(?!\{\{#(if|unless))[\s\S])*?)\{\{\/\1\}\}/g
  for (let pass = 0; pass < 20; pass += 1) {
    if (!block.test(output)) break
    block.lastIndex = 0
    output = output.replace(block, (_match, kind: string, key: string, inner: string) => {
      const show = kind === 'if' ? isOn(bag[key]) : !isOn(bag[key])
      return show ? inner : ''
    })
  }
  return output
}

function substitute(source: string, bag: Bag): string {
  return source.replace(/\{\{([a-z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = bag[key]
    if (typeof value === 'string') return value
    return ''
  })
}

function stripUnresolved(source: string): string {
  let output = source
  for (let pass = 0; pass < 8; pass += 1) {
    const next = output
      .replace(/\{\{#if [a-z0-9_]+\}\}[\s\S]*?\{\{\/if\}\}/g, '')
      .replace(/\{\{#unless [a-z0-9_]+\}\}[\s\S]*?\{\{\/unless\}\}/g, '')
    if (next === output) break
    output = next
  }
  return output.replace(/\{\{[^{}]+\}\}/g, '')
}

function tidyLegalParenthetical(source: string): string {
  return source.replace(/, company number (?=\))/g, '')
}

function inlineMarkup(text: string): string {
  const withLinks = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const target = href.trim()
    const labelHtml = label.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    if (!isHttpUrl(target)) return labelHtml
    return `<a href="${escapeHtml(target)}" rel="noopener noreferrer">${labelHtml}</a>`
  })
  return withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function tableHtml(lines: string[]): string {
  const rows = lines.map((line) =>
    line.split('|').slice(1, -1).map((cell) => cell.trim()),
  )
  const content = rows.filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)))
  if (content.length === 0) return ''
  const head = content[0]
  const body = content.slice(1)
  const headHtml = head.map((cell) => `<th>${inlineMarkup(cell)}</th>`).join('')
  const bodyHtml = body
    .map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkup(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim())
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${inlineMarkup(heading[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index].trim())
        index += 1
      }
      const table = tableHtml(tableLines)
      if (table) html.push(table)
      continue
    }

    if (line.trim().startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length) {
        if (!lines[index].trim()) {
          let look = index + 1
          while (look < lines.length && !lines[look].trim()) look += 1
          const next = lines[look] || ''
          if (next.trim().startsWith('- ') || /^\s+\S/.test(next)) {
            index += 1
            continue
          }
          break
        }
        if (lines[index].trim().startsWith('- ')) {
          items.push(lines[index].trim().slice(2))
          index += 1
          continue
        }
        if (/^\s+\S/.test(lines[index]) && items.length > 0) {
          items[items.length - 1] += ` ${lines[index].trim()}`
          index += 1
          continue
        }
        break
      }
      const list = items
        .map((item) => `<li>${inlineMarkup(item.replace(/\s+/g, ' ').trim())}</li>`)
        .join('')
      html.push(`<ul>${list}</ul>`)
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].trim().startsWith('#')
      && !lines[index].trim().startsWith('|')
      && !lines[index].trim().startsWith('- ')
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
    if (text) html.push(`<p>${inlineMarkup(text)}</p>`)
  }

  return html.join('\n')
}

function retentionDays(facts: VisitorLegalFacts): number {
  const stored = facts.messageRetentionDays
  if (typeof stored === 'number' && Number.isInteger(stored) && stored > 0) return stored
  return facts.clinic ? 90 : 365
}

function contactFallback(name: string, phone: string, email: string): string | null {
  if (email) return null
  if (phone) return `Contact: ${escapeBusiness(phone)}.`
  return `Contact ${escapeBusiness(name)} directly, or email support@styleflo.ai and we'll pass your message on.`
}

export function renderVisitorLegal(
  kind: VisitorLegalKind,
  facts: VisitorLegalFacts,
  env: NodeJS.ProcessEnv = process.env,
): VisitorLegalDocument {
  const template = kind === 'terms'
    ? {
      body: VISITOR_TERMS_BODY,
      version: VISITOR_TERMS_VERSION,
      effectiveDate: VISITOR_TERMS_EFFECTIVE_DATE,
      status: VISITOR_TERMS_STATUS,
    }
    : {
      body: VISITOR_PRIVACY_BODY,
      version: VISITOR_PRIVACY_VERSION,
      effectiveDate: VISITOR_PRIVACY_EFFECTIVE_DATE,
      status: VISITOR_PRIVACY_STATUS,
    }

  const rawName = clean(facts.companyName)
  const businessName = rawName || BLANK_BUSINESS_NAME
  const legalName = facts.registeredCompany && rawName ? rawName : ''
  const crn = facts.registeredCompany ? clean(facts.companyRegistrationNumber) : ''
  const tradingAddress = joinAddress(facts.tradingStreet, facts.tradingCity, facts.tradingPostcode)
  const registeredAddress = joinAddress(facts.registeredStreet, facts.registeredCity, facts.registeredPostcode)
  const address = tradingAddress || registeredAddress
  const phone = clean(facts.tradingPhone)
  const email = clean(facts.publicContactEmail)
  const privacyUrl = isHttpUrl(clean(facts.businessPrivacyUrl)) ? clean(facts.businessPrivacyUrl) : ''
  const agentName = clean(facts.agentName) || BLANK_AGENT_NAME
  const origin = resolveServerPublicAppOrigin(env)
  const termsUrl = `${origin}/v/${facts.slug}/terms`
  const privacyPageUrl = `${origin}/v/${facts.slug}/privacy`
  const retention = transcriptRetentionPhrase(retentionDays(facts))

  const bag: Bag = {
    business_name: escapeBusiness(businessName),
    business_legal_name: escapeBusiness(legalName),
    business_crn: escapeBusiness(crn),
    business_address: escapeBusiness(address),
    business_contact_email: escapeBusiness(email),
    business_phone: escapeBusiness(phone),
    business_privacy_url: privacyUrl,
    is_clinic: facts.clinic,
    agent_name: escapeBusiness(agentName),
    voice_enabled: facts.voiceEnabled,
    phone_enabled: facts.phoneEnabled,
    sms_enabled: facts.smsEnabled,
    business_slug: escapeBusiness(facts.slug),
    version: escapeBusiness(template.version),
    effective_date: escapeBusiness(template.effectiveDate),
    hide_branding: facts.hideBranding,
    privacy_link: privacyPageUrl,
    visitor_privacy_url: privacyPageUrl,
    visitor_terms_url: termsUrl,
    styleflo_privacy_url: STYLEFLO_PRIVACY_URL,
    marketing_enabled: facts.marketingEnabled,
    special_category_basis: SPECIAL_CATEGORY_BASIS_FALLBACK,
    transfers_summary: TRANSFERS_SUMMARY_FALLBACK,
    subprocessor_list_url: '',
  }

  let source = template.body
  const fallbackLine = contactFallback(businessName, phone, email)
  if (fallbackLine) {
    source = source.split(CONTACT_LINE).join(fallbackLine)
  }
  source = source.split(SUBPROCESSOR_LINK).join('Sub-processor list [link to be confirmed]')
  source = source.split(RETENTION_TOKEN).join(retention)
  source = applyConditionals(source, bag)
  source = substitute(source, bag)
  source = tidyLegalParenthetical(source)
  source = stripUnresolved(source)

  const title = kind === 'terms'
    ? `Terms of use for ${businessName}'s AI assistant`
    : `Privacy notice: ${businessName}'s AI assistant`

  return {
    kind,
    status: template.status,
    version: template.version,
    effectiveDate: template.effectiveDate,
    title,
    banner: template.status === 'DRAFT' ? VISITOR_LEGAL_DRAFT_BANNER : '',
    html: markdownToHtml(source),
  }
}
