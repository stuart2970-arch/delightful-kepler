import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { resendSystemEmail } from '@/lib/email/system/log'

export const dynamic = 'force-dynamic'

function statusFor(code: string): number {
  if (code === 'invalid_input') return 400
  if (code === 'not_found' || code === 'unknown_template') return 404
  if (code === 'recipient_not_allowed' || code === 'tenant_not_found') return 422
  if (code === 'send_failed') return 502
  return 500
}

export const POST = withSuperAdmin(async (req: NextRequest) => {
  let body: { logId?: unknown; idempotencyKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const logId = typeof body?.logId === 'string' ? body.logId.trim() : ''
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : undefined
  const result = await resendSystemEmail({ logId, idempotencyKey })
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: statusFor(result.code) })
  }
  return NextResponse.json(result)
})
