/** Agreed British English wording (STYL-225). */
export const NAME_POLICY_MESSAGES = {
  block: "Sorry, that name can't be used. Please choose a different one.",
  review:
    "Thanks! We need to check this name quickly. You can carry on setting up, and we'll be in touch within one working day.",
  reserved: 'That web address is reserved. Try adding your town, e.g. glamour-puss-leeds.',
  emoji: 'Please use letters and numbers only.',
} as const

export type NamePolicyAction = 'allow' | 'block' | 'review' | 'reserved' | 'emoji' | 'flag'

export type NamePolicyContext = 'owner' | 'salon' | 'slug' | 'persona' | 'chat'

export type NamePolicyDecision = {
  action: NamePolicyAction
  message: string | null
  term: string | null
}

export function messageForAction(action: NamePolicyAction): string | null {
  if (action === 'allow' || action === 'flag') return null
  return NAME_POLICY_MESSAGES[action]
}

export function knownNamePolicyMessage(message: string | null | undefined): string | null {
  if (!message) return null
  for (const text of Object.values(NAME_POLICY_MESSAGES)) {
    if (message.includes(text)) return text
  }
  return null
}

export type CheckedName = { field: string; action: string; message: string | null }

export async function checkSignupNames(input: {
  ownerName?: string
  salonName?: string
  slug?: string
  personaName?: string
}): Promise<CheckedName[]> {
  const response = await fetch('/api/moderation/check-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const errorText = typeof data.error === 'string' ? data.error : 'Name check is unavailable.'
    throw new Error(errorText)
  }
  return Array.isArray(data.results) ? data.results : []
}

export function hardNameRejection(results: CheckedName[]): string | null {
  const hard = results.find((row) => row.action === 'block' || row.action === 'reserved' || row.action === 'emoji')
  return hard?.message || null
}

export function reviewNameMessage(results: CheckedName[]): string | null {
  const review = results.find((row) => row.action === 'review')
  return review?.message || null
}
