import { createSystemEmailAdmin } from '../../admin'
import { complaintForwardRecipient, isSystemEmailsBatch4Enabled } from './enabled'
import { sendBatch4Notice } from './notices'

export function messageAsksForAPerson(text: string): boolean {
  return /\b(speak to (a person|someone|a human)|talk to (a person|someone|a human)|call me back|human support|real person)\b/i.test(text)
}

export function messageIsLabelledComplaint(text: string): boolean {
  return /\b(i want to make a complaint|this is a complaint|formal complaint)\b/i.test(text)
}

async function accountEmail(tenantId: string): Promise<string | null> {
  const admin = createSystemEmailAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  if (!profile?.id) return null
  const { data } = await admin.auth.admin.getUserById(profile.id)
  return data?.user?.email || null
}

async function transcriptFor(tenantId: string, conversationId: string, fallback: string): Promise<string> {
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
 * App trigger for a StyleFlo chat message. No-op unless batch 4 is enabled.
 * A complaint is forwarded once per conversation. A request for a person is logged once per conversation.
 */
export async function dispatchBatch4ChatEmail(input: {
  tenantId: string
  conversationId: string
  messageText: string
  businessName?: string
  to?: string
}): Promise<void> {
  if (!isSystemEmailsBatch4Enabled()) return
  const text = input.messageText || ''
  const wantsPerson = messageAsksForAPerson(text)
  const complaint = messageIsLabelledComplaint(text)
  if (!wantsPerson && !complaint) return

  const to = input.to?.trim() || await accountEmail(input.tenantId)
  if (!to) return
  const businessName = input.businessName?.trim() || 'your business'

  if (wantsPerson) {
    await sendBatch4Notice({
      templateKey: 'support.human-follow-up',
      tenantId: input.tenantId,
      to,
      eventId: input.conversationId,
      data: {
        businessName,
        requestSummary: 'You asked to speak to a person.',
      },
    })
  }

  if (complaint) {
    const transcript = await transcriptFor(input.tenantId, input.conversationId, text)
    await sendBatch4Notice({
      templateKey: 'complaint.forward',
      tenantId: input.tenantId,
      to: complaintForwardRecipient(),
      eventId: input.conversationId,
      data: { businessName, complainant: to, transcript },
    })
    await sendBatch4Notice({
      templateKey: 'complaint.acknowledgement',
      tenantId: input.tenantId,
      to,
      eventId: input.conversationId,
      data: { complainant: 'there' },
    })
  }
}
