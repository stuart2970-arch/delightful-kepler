import { tenantIsHouse } from '@/lib/moderation/assess-stored-name'
import { createSystemEmailAdmin } from '../../admin'
import { complaintForwardRecipient, isSystemEmailsBatch4Enabled } from './enabled'
import { sendBatch4Notice } from './notices'

const VISITOR_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export function messageAsksForAPerson(text: string): boolean {
  return /\b(speak to (a person|someone|a human)|talk to (a person|someone|a human)|human support|real person)\b/i.test(text)
}

export function messageIsLabelledComplaint(text: string): boolean {
  return /\b(i want to make a complaint|this is a complaint|formal complaint)\b/i.test(text)
}

/** The visitor's own address. Never the tenant owner looked up from the account. */
export function capturedVisitorEmail(...parts: Array<string | null | undefined>): string | null {
  for (const part of parts) {
    const match = (part || '').match(VISITOR_EMAIL)
    if (!match) continue
    const email = match[0].trim().toLowerCase()
    if (email === 'user@example.com') continue
    return email
  }
  return null
}

async function transcriptFor(conversationId: string, fallback: string): Promise<string> {
  const admin = createSystemEmailAdmin()
  const { data } = await admin
    .from('messages')
    .select('sender_type, text_content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (!data || data.length === 0) return fallback
  return data
    .map((row) => `${row.sender_type === 'user' ? 'Customer' : 'Assistant'}: ${row.text_content || ''}`)
    .join('\n')
}

/**
 * StyleFlo's own chat only (the house tenant on the moderation allowlist).
 * No-op unless batch 4 is enabled. A complaint is forwarded once per conversation.
 * The acknowledgement and the human follow-up go to the visitor's own email, or are skipped.
 */
export async function dispatchBatch4ChatEmail(input: {
  tenantId: string
  conversationId: string
  messageText: string
  businessName?: string
  visitorEmail?: string | null
}): Promise<void> {
  if (!isSystemEmailsBatch4Enabled()) return
  const text = input.messageText || ''
  const wantsPerson = messageAsksForAPerson(text)
  const complaint = messageIsLabelledComplaint(text)
  if (!wantsPerson && !complaint) return

  let house = false
  try {
    house = await tenantIsHouse(createSystemEmailAdmin(), input.tenantId)
  } catch {
    return
  }
  if (!house) return

  const visitor = capturedVisitorEmail(input.visitorEmail, text)
  const businessName = input.businessName?.trim() || 'StyleFlo'

  if (wantsPerson && visitor) {
    await sendBatch4Notice({
      templateKey: 'support.human-follow-up',
      tenantId: input.tenantId,
      to: visitor,
      eventId: input.conversationId,
      data: {
        businessName,
        requestSummary: 'You asked to speak to a person.',
      },
    })
  }

  if (!complaint) return
  const transcript = await transcriptFor(input.conversationId, text)
  await sendBatch4Notice({
    templateKey: 'complaint.forward',
    tenantId: input.tenantId,
    to: complaintForwardRecipient(),
    eventId: input.conversationId,
    data: { businessName, complainant: visitor || 'Not stated', transcript },
  })
  if (!visitor) return
  await sendBatch4Notice({
    templateKey: 'complaint.acknowledgement',
    tenantId: input.tenantId,
    to: visitor,
    eventId: input.conversationId,
    data: { complainant: 'there' },
  })
}
