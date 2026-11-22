import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { isSystemEmailTenantId } from '@/lib/email/system/data'
import { listRegisteredTemplateSummaries, listSystemEmailLog } from '@/lib/email/system/log'

export const dynamic = 'force-dynamic'

export const GET = withSuperAdmin(async (req: NextRequest) => {
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 50
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (tenantId && !isSystemEmailTenantId(tenantId)) {
    return NextResponse.json({ error: 'tenantId must be a tenant id.' }, { status: 400 })
  }

  try {
    const emails = await listSystemEmailLog({ limit, tenantId })
    return NextResponse.json({
      emails,
      templates: listRegisteredTemplateSummaries(),
    })
  } catch {
    return NextResponse.json({ error: 'Could not load the system email log.' }, { status: 500 })
  }
})
