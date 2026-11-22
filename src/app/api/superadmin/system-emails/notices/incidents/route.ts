import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { runBreachNotice } from '@/lib/email/system/triggers/batch3/incidents'

export const dynamic = 'force-dynamic'

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const POST = withSuperAdmin(async (req: NextRequest, _ctx, admin) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const dryRun = body.dryRun === true
  const confirm = body.confirm === true
  if (dryRun === confirm) {
    return NextResponse.json({ error: 'Choose a dry run or an explicit confirm.' }, { status: 400 })
  }

  const kind = body.kind === 'individuals' ? 'individuals' : body.kind === 'salon' ? 'salon' : ''
  if (!kind) return NextResponse.json({ error: 'The incident kind is not valid.' }, { status: 400 })

  const result = await runBreachNotice({
    incidentId: text(body.incidentId),
    kind,
    tenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
    awarenessAt: text(body.awarenessAt),
    nature: text(body.nature),
    peopleAffected: text(body.peopleAffected),
    recordsAffected: text(body.recordsAffected),
    consequences: text(body.consequences),
    measures: text(body.measures),
    contactName: text(body.contactName),
    recipients: Array.isArray(body.recipients) ? body.recipients.filter((item) => typeof item === 'string') : [],
    dryRun,
    createdBy: admin.userId,
  })

  if (!result.ok) {
    const status = result.code === 'disabled' ? 409 : result.code === 'not_found' ? 404 : result.code === 'store_failed' ? 500 : 400
    return NextResponse.json({ error: result.message, code: result.code, sent: 0 }, { status })
  }

  return NextResponse.json(result)
})
