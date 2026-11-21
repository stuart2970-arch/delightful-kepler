import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase-admin'
import { handleMicrosoftCalendarWebhook } from '@/lib/calendar/push-sync/microsoft-webhook'
import type { MicrosoftNotificationItem } from '@/lib/calendar/push-sync/reconcile'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  try {
    const body = await request.json()
    const items = (Array.isArray(body?.value) ? body.value : []) as MicrosoftNotificationItem[]
    if (items.length === 0) {
      return NextResponse.json({ error: 'Empty notification batch' }, { status: 400 })
    }

    const admin = createAdminClient()
    const result = await handleMicrosoftCalendarWebhook(admin, items)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, processed: result.processed })
  } catch (error) {
    console.error('[Microsoft calendar webhook]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}