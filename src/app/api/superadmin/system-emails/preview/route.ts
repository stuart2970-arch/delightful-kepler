import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { systemEmailStringData } from '@/lib/email/system/data'
import { previewSystemEmail } from '@/lib/email/system/registry'

export const dynamic = 'force-dynamic'

export const POST = withSuperAdmin(async (req: NextRequest) => {
  let body: { templateKey?: unknown; data?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const templateKey = typeof body?.templateKey === 'string' ? body.templateKey.trim() : ''
  if (!templateKey) {
    return NextResponse.json({ error: 'templateKey is required.' }, { status: 400 })
  }

  const rendered = previewSystemEmail(templateKey, systemEmailStringData(body.data))
  if (!rendered) {
    return NextResponse.json({ error: 'That system email template is not registered.' }, { status: 404 })
  }

  return NextResponse.json({
    templateKey,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })
})
