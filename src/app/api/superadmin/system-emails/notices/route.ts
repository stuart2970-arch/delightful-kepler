import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { systemEmailStringData } from '@/lib/email/system/data'
import { BATCH3_MASS_NOTICES } from '@/lib/email/system/templates/batch-3'
import { runMassNotice } from '@/lib/email/system/triggers/batch3/mass-notice'

export const dynamic = 'force-dynamic'

export const GET = withSuperAdmin(async () => {
  return NextResponse.json({
    notices: BATCH3_MASS_NOTICES.map((notice) => ({
      number: notice.number,
      key: notice.key,
      label: notice.label,
      fields: notice.fields,
    })),
  })
})

export const POST = withSuperAdmin(async (req: NextRequest) => {
  let body: {
    noticeId?: unknown
    templateKey?: unknown
    data?: unknown
    dryRun?: unknown
    confirm?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const dryRun = body.dryRun === true
  const confirm = body.confirm === true
  if (dryRun === confirm) {
    return NextResponse.json(
      { error: 'Choose a dry run or an explicit confirm. A dry run sends nothing.' },
      { status: 400 },
    )
  }

  const result = await runMassNotice({
    noticeId: typeof body.noticeId === 'string' ? body.noticeId : '',
    templateKey: typeof body.templateKey === 'string' ? body.templateKey : '',
    data: systemEmailStringData(body.data),
    dryRun,
  })

  if (!result.ok) {
    const status = result.code === 'disabled' ? 409 : result.code === 'list_failed' ? 500 : 400
    return NextResponse.json({ error: result.message, code: result.code, sent: 0 }, { status })
  }

  return NextResponse.json({
    dryRun: result.dryRun,
    enabled: result.enabled,
    noticeId: result.noticeId,
    templateKey: result.templateKey,
    sent: result.sent,
    duplicates: result.duplicates,
    failed: result.failed,
    recipients: result.recipients.map((recipient) => ({
      tenantId: recipient.tenantId,
      businessName: recipient.businessName,
      email: recipient.email,
    })),
    results: result.results,
  })
})
