import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { systemEmailStringData } from '@/lib/email/system/data'
import { DATA_RIGHTS_TEMPLATES, runDataRightsNotice, type DataRightsKind } from '@/lib/email/system/triggers/batch3/data-rights'

export const dynamic = 'force-dynamic'

const isKind = (value: unknown): value is DataRightsKind => {
  return typeof value === 'string' && value in DATA_RIGHTS_TEMPLATES
}

export const POST = withSuperAdmin(async (req: NextRequest) => {
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
  if (!isKind(body.kind)) {
    return NextResponse.json({ error: 'The notice kind is not valid.' }, { status: 400 })
  }

  const result = await runDataRightsNotice({
    requestId: typeof body.requestId === 'string' ? body.requestId : '',
    kind: body.kind,
    tenantId: typeof body.tenantId === 'string' ? body.tenantId : '',
    data: systemEmailStringData(body.data),
    dryRun,
  })

  if (!result.ok) {
    const status = result.code === 'disabled' ? 409 : result.code === 'not_found' ? 404 : result.code === 'log_failed' ? 500 : 400
    return NextResponse.json({ error: result.message, code: result.code }, { status })
  }
  return NextResponse.json(result)
})
