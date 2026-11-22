import {
  DataSet,
  RegExpMatcher,
  englishRecommendedTransformers,
  parseRawPattern,
  type MatchPayload,
} from 'obscenity'
import list from '@dsojevic/profanity-list'
import { RESERVED_SLUGS } from '@/lib/moderation/reserved-names'
import {
  messageForAction,
  type NamePolicyAction,
  type NamePolicyContext,
  type NamePolicyDecision,
} from '@/lib/moderation/messages'

export type NameOverride = {
  term: string
  kind: string
  severity: number
  action: NamePolicyAction | string
}

type ProfanityHit = { term: string; severity: number }

const LEET_FROM = '@431!|5$70(/62'
const LEET_TO = 'aaeiiisstoclgz'
const CONFUSABLE_FROM = 'аеорсухіѕјАЕОРСУХІ'
const CONFUSABLE_TO = 'aeopcyxicjAEOPCYXI'

const RESERVED = new Set(RESERVED_SLUGS)
const BRAND_TOKENS = new Set(['styleflo', 'stylefloai'])
const IMPERSONATION_EXACT = new Set([
  'support',
  'official',
  'staff',
  'team',
  'admin',
  'verified',
  'styleflo',
  'stylefloai',
  'styleflo support',
  'styleflo official',
  'official support',
  'styleflo staff',
  'styleflo team',
  'styleflo admin',
  'styleflo verified',
])

const SAFE_WHITELIST = [
  'scunthorpe',
  'penistone',
  'essex',
  'cockburn',
  'dickson',
  'hancock',
  'glamour puss',
  'hair kuts',
]

type PhraseMeta = { id: string; severity: number }

let matcher: RegExpMatcher | null = null
let dataset: DataSet<PhraseMeta> | null = null

function bases(match: string): string[] {
  return [...new Set(
    match
      .split('|')
      .map((part) => part.trim().toLowerCase().replace(/\*/g, ''))
      .filter((part) => part.length >= 3 && /^[\p{L}\p{N} '’-]+$/u.test(part)),
  )]
}

function engine(): { matcher: RegExpMatcher; dataset: DataSet<PhraseMeta> } {
  if (matcher && dataset) return { matcher, dataset }
  const built = new DataSet<PhraseMeta>()
  const seen = new Set<string>()
  const items = [...list.en].sort((left, right) => Number(right.severity) - Number(left.severity))
  for (const item of items) {
    for (const text of bases(String(item.match))) {
      if (seen.has(text)) continue
      seen.add(text)
      built.addPhrase((phrase) => {
        phrase.setMetadata({ id: text, severity: Number(item.severity) })
        phrase.addPattern(parseRawPattern(`|${text}|`))
        return phrase
      })
    }
  }
  dataset = built
  matcher = new RegExpMatcher({
    ...built.build(),
    ...englishRecommendedTransformers,
    whitelistedTerms: SAFE_WHITELIST,
  })
  return { matcher, dataset }
}

function translateChars(value: string, from: string, to: string): string {
  const map = new Map<string, string>()
  const source = [...from]
  const target = [...to]
  source.forEach((char, index) => {
    const next = target[index]
    if (next) map.set(char, next)
  })
  return [...value].map((char) => map.get(char) ?? char).join('')
}

/** NFKC, case, diacritics, lookalikes, leetspeak, and collapsed 3+ repeats. */
export function normalizeModerationText(value: string): string {
  const folded = value
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
  const mapped = translateChars(translateChars(folded, CONFUSABLE_FROM, CONFUSABLE_TO), LEET_FROM, LEET_TO)
  return mapped.replace(/(.)\1{2,}/g, '$1')
}

export function moderationTokens(value: string): string[] {
  const spaced = normalizeModerationText(value).replace(/[^a-z0-9]+/g, ' ').trim()
  if (!spaced) return []
  return spaced.split(/ +/)
}

export function moderationSlugKey(value: string): string {
  return normalizeModerationText(value).replace(/[^a-z0-9]+/g, '')
}

export function containsEmoji(value: string): boolean {
  return /\p{Extended_Pictographic}/u.test(value)
}

function allow(): NamePolicyDecision {
  return { action: 'allow', message: null, term: null }
}

function decide(action: NamePolicyAction, term: string | null): NamePolicyDecision {
  return { action, message: messageForAction(action), term }
}

function profanityHits(value: string): ProfanityHit[] {
  const { matcher: active, dataset: terms } = engine()
  const matches = active.getAllMatches(value)
  return matches.map((match: MatchPayload) => {
    const payload = terms.getPayloadWithPhraseMetadata(match)
    return {
      term: payload.phraseMetadata?.id ?? 'profanity',
      severity: Number(payload.phraseMetadata?.severity ?? 3),
    }
  })
}

function suppressed(hits: ProfanityHit[], overrides: NameOverride[]): ProfanityHit[] {
  const allowed = new Set(
    overrides
      .filter((row) => row.action === 'allow')
      .map((row) => normalizeModerationText(row.term).replace(/[^a-z0-9]+/g, '')),
  )
  return hits.filter((hit) => !allowed.has(normalizeModerationText(hit.term).replace(/[^a-z0-9]+/g, '')))
}

function overrideHits(tokens: string[], spaced: string, overrides: NameOverride[]): ProfanityHit[] {
  const hits: ProfanityHit[] = []
  for (const row of overrides) {
    if (row.action === 'allow' || row.kind === 'reserved' || row.kind === 'impersonation' || row.kind === 'brand_token') {
      continue
    }
    const term = normalizeModerationText(row.term).replace(/[^a-z0-9]+/g, ' ').trim()
    const key = term.replace(/ /g, '')
    const matched = term.includes(' ')
      ? ` ${spaced} `.includes(` ${term} `)
      : tokens.includes(key)
    if (!matched) continue
    const severity = row.action === 'block' ? Math.max(Number(row.severity) || 4, 3) : Number(row.severity) || 1
    hits.push({ term: key || term, severity })
  }
  return hits
}

function reservedOverride(slugKey: string, overrides: NameOverride[]): 'reserved' | 'allow' | null {
  for (const row of overrides) {
    if (row.kind !== 'reserved' && row.action !== 'reserved') continue
    const key = moderationSlugKey(row.term)
    if (key !== slugKey) continue
    if (row.action === 'allow') return 'allow'
    if (row.action === 'reserved' || row.action === 'block') return 'reserved'
  }
  return null
}

function brandPhrase(spaced: string): boolean {
  return spaced.split(' ').some((token) => BRAND_TOKENS.has(token))
}

/** Brand token, or an impersonation phrase that contains one (StyleFlo Support). */
function personaBrandHit(spaced: string, tokens: string[], overrides: NameOverride[]): boolean {
  const allowed = new Set(
    overrides.filter((row) => row.action === 'allow').map((row) => moderationSlugKey(row.term)),
  )
  if (tokens.some((token) => BRAND_TOKENS.has(token) && !allowed.has(token))) return true
  if (IMPERSONATION_EXACT.has(spaced) && brandPhrase(spaced) && !allowed.has(spaced.replace(/ /g, ''))) return true
  for (const row of overrides) {
    if (row.action === 'allow') continue
    const term = normalizeModerationText(row.term).replace(/[^a-z0-9]+/g, ' ').trim()
    if (!term) continue
    if (row.kind === 'brand_token' && tokens.includes(term.replace(/ /g, '')) && !allowed.has(term.replace(/ /g, ''))) {
      return true
    }
    if (row.kind === 'impersonation' && spaced === term && brandPhrase(term) && !allowed.has(term.replace(/ /g, ''))) {
      return true
    }
  }
  return false
}

function personaImpersonation(spaced: string, tokens: string[], overrides: NameOverride[]): boolean {
  const allowed = new Set(
    overrides.filter((row) => row.action === 'allow').map((row) => moderationSlugKey(row.term)),
  )
  if (tokens.some((token) => BRAND_TOKENS.has(token) && !allowed.has(token))) return true
  if (IMPERSONATION_EXACT.has(spaced) && !allowed.has(spaced.replace(/ /g, ''))) return true
  for (const row of overrides) {
    if (row.action === 'allow') continue
    if (row.kind !== 'impersonation' && row.kind !== 'brand_token') continue
    const term = normalizeModerationText(row.term).replace(/[^a-z0-9]+/g, ' ').trim()
    if (!term) continue
    if (row.kind === 'brand_token' && tokens.includes(term.replace(/ /g, ''))) return true
    if (row.kind === 'impersonation' && spaced === term) return true
  }
  return false
}

/**
 * Whole-word check. Obscenity supplies leetspeak, confusable, and repeat
 * collapsing. The English dataset is not loaded: its patterns match inside
 * Penistone and Dickson. UK terms come from @dsojevic/profanity-list.
 * Superadmin rows override the built-in lists.
 */
export type AssessNameOptions = {
  house?: boolean
}

export function assessName(
  value: string,
  context: NamePolicyContext,
  overrides: NameOverride[] = [],
  options: AssessNameOptions = {},
): NamePolicyDecision {
  const raw = typeof value === 'string' ? value : ''
  if (!raw.trim()) return allow()

  const emoji = containsEmoji(raw)
  if (emoji && context !== 'owner' && context !== 'chat') return decide('emoji', null)
  if (context === 'chat' && emoji) return { action: 'flag', message: null, term: 'emoji' }

  const tokens = moderationTokens(raw)
  const spaced = tokens.join(' ')
  const slugKey = moderationSlugKey(raw)
  const hits = suppressed(
    [...profanityHits(raw), ...overrideHits(tokens, spaced, overrides)],
    overrides,
  )
  const severe = hits.find((hit) => hit.severity >= 3) ?? null
  const mild = hits.find((hit) => hit.severity >= 1 && hit.severity < 3) ?? null

  if (context === 'chat') {
    const hit = severe ?? mild
    return hit ? { action: 'flag', message: null, term: hit.term } : allow()
  }

  if (context === 'slug') {
    const reservedDecision = reservedOverride(slugKey, overrides)
    const reservedHit = reservedDecision === 'reserved' || (reservedDecision !== 'allow' && RESERVED.has(slugKey))
    if (reservedHit && !options.house) {
      return decide('reserved', slugKey)
    }
    if (severe) return decide('block', severe.term)
    if (mild) return decide('review', mild.term)
    return allow()
  }

  if (context === 'owner') {
    if (severe) return decide('block', severe.term)
    return allow()
  }

  if (context === 'persona' && personaImpersonation(spaced, tokens, overrides)) {
    const houseBrand = options.house && personaBrandHit(spaced, tokens, overrides)
    if (!houseBrand) return decide('block', spaced)
  }

  if (severe) return decide('block', severe.term)
  if ((context === 'salon' || context === 'persona') && mild) return decide('review', mild.term)
  return allow()
}

const ACTION_RANK: Record<NamePolicyAction, number> = {
  block: 5,
  emoji: 4,
  reserved: 3,
  review: 2,
  flag: 1,
  allow: 0,
}

export function stricterDecision(left: NamePolicyDecision, right: NamePolicyDecision): NamePolicyDecision {
  return ACTION_RANK[left.action] >= ACTION_RANK[right.action] ? left : right
}
