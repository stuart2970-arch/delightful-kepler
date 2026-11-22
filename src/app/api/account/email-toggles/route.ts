import { NextRequest, NextResponse } from 'next/server'
import { requireTenantRole } from '@/lib/auth/require-tenant-role'
import { readTenantEmailToggles, writeTenantEmailToggles } from '@/lib/email/tenant-email-toggles'

export async function GET(req: NextRequest) {
  const auth = await requireTenantRole(req, ['owner', 'admin'])
  if (!auth.ok) return auth.response
  const toggles = await readTenantEmailToggles(auth.tenantId)
  return NextResponse.json({
    accountEmail: auth.email,
    ...toggles,
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireTenantRole(req, ['owner', 'admin'])
  if (!auth.ok) return auth.response

  let body: { enquiryDetailsEmailEnabled?: unknown; bookingConfirmationEmailEnabled?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const patch: { enquiryDetailsEmailEnabled?: boolean; bookingConfirmationEmailEnabled?: boolean } = {}
  if (body.enquiryDetailsEmailEnabled !== undefined) {
    if (typeof body.enquiryDetailsEmailEnabled !== 'boolean') {
      return NextResponse.json({ error: 'enquiryDetailsEmailEnabled must be true or false.' }, { status: 400 })
    }
    patch.enquiryDetailsEmailEnabled = body.enquiryDetailsEmailEnabled
  }
  if (body.bookingConfirmationEmailEnabled !== undefined) {
    if (typeof body.bookingConfirmationEmailEnabled !== 'boolean') {
      return NextResponse.json({ error: 'bookingConfirmationEmailEnabled must be true or false.' }, { status: 400 })
    }
    patch.bookingConfirmationEmailEnabled = body.bookingConfirmationEmailEnabled
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Choose an email to turn on or off.' }, { status: 400 })
  }

  const saved = await writeTenantEmailToggles(auth.tenantId, patch)
  if (!saved) {
    return NextResponse.json({ error: 'The email settings could not be saved.' }, { status: 500 })
  }
  return NextResponse.json({ accountEmail: auth.email, ...saved })
}
