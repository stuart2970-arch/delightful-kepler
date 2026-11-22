import { NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { recordSuperadminAudit } from '@/lib/auth/superadmin-audit'
import { complaintForwardRecipient } from '@/lib/email/system/triggers/batch4/enabled'
import { sendBatch4Notice, sendTermsEndNotice } from '@/lib/email/system/triggers/batch4/notices'

const KINDS = [
  'breach',
  'suspension',
  'termination',
  'terms-end',
  'fair-use',
  'channel-launch',
  'maintenance',
  'support-follow-up',
  'complaint-forward',
  'complaint-acknowledgement',
] as const

type Kind = (typeof KINDS)[number]

const TEMPLATE_BY_KIND: Record<Exclude<Kind, 'terms-end'>, string> = {
  breach: 'enforcement.breach.notice',
  suspension: 'enforcement.suspension.notice',
  termination: 'enforcement.termination.notice',
  'fair-use': 'fair-use.warning',
  'channel-launch': 'channel.launch.notice',
  maintenance: 'maintenance.planned.notice',
  'support-follow-up': 'support.human-follow-up',
  'complaint-forward': 'complaint.forward',
  'complaint-acknowledgement': 'complaint.acknowledgement',
}

function asStrings(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') data[key] = value
  }
  return data
}

export const POST = withSuperAdmin(async (req, _ctx, admin) => {
  let body: {
    kind?: unknown
    tenantId?: unknown
    to?: unknown
    eventId?: unknown
    businessName?: unknown
    endDate?: unknown
    data?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!KINDS.includes(kind as Kind)) {
    return NextResponse.json({ error: 'That notice is not in this batch.' }, { status: 400 })
  }
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : ''
  const to = typeof body.to === 'string' ? body.to : ''
  const eventId = typeof body.eventId === 'string' ? body.eventId : ''
  if (!tenantId || !to || !eventId) {
    return NextResponse.json({ error: 'A tenant, recipient and event id are required.' }, { status: 400 })
  }

  recordSuperadminAudit({
    action: 'system-email.batch4',
    userId: admin.userId,
    tenantId,
    detail: { kind, eventId },
  })

  if (kind === 'terms-end') {
    const businessName = typeof body.businessName === 'string' ? body.businessName : ''
    const endDate = typeof body.endDate === 'string' ? body.endDate : ''
    const result = await sendTermsEndNotice({ tenantId, to, eventId, businessName, endDate })
    const status = result.ok ? 200 : result.code === 'disabled' ? 409 : 400
    return NextResponse.json(result, { status })
  }

  const noticeKind = kind as Exclude<Kind, 'terms-end'>
  const data: Record<string, string> = {
    ...asStrings(body.data),
    ...(typeof body.businessName === 'string' ? { businessName: body.businessName } : {}),
  }
  if (noticeKind === 'termination') {
    data.reason = data.reason === 'Misuse has been confirmed.'
      ? 'Misuse has been confirmed.'
      : 'The breach was not put right within 14 days.'
  }
  const result = await sendBatch4Notice({
    templateKey: TEMPLATE_BY_KIND[noticeKind],
    tenantId,
    to: kind === 'complaint-forward' ? complaintForwardRecipient() : to,
    eventId,
    data,
  })
  const status = result.ok ? 200 : result.code === 'disabled' ? 409 : 400
  return NextResponse.json(result, { status })
})
