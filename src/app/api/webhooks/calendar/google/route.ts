import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase-admin'
import { calendarPushTestMocksAllowed } from '@/lib/calendar/push-sync/config'
import { handleGoogleCalendarWebhook } from '@/lib/calendar/push-sync/google-webhook'
import type { MockGoogleEventPayload } from '@/lib/calendar/push-sync/reconcile'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const channelId = request.headers.get('x-goog-channel-id')?.trim() ?? ''
    const channelToken = request.headers.get('x-goog-channel-token')?.trim() ?? ''
    const resourceState = request.headers.get('x-goog-resource-state')?.trim() ?? 'sync'

    if (!channelId || !channelToken) {
      return NextResponse.json({ error: 'Missing Google channel headers' }, { status: 400 })
    }

    let mockEventPayloads: MockGoogleEventPayload[] | undefined
    if (calendarPushTestMocksAllowed()) {
      try {
        const body = await request.clone().json()
        if (Array.isArray(body?.mockEventPayloads)) {
          mockEventPayloads = body.mockEventPayloads
        }
      } catch {
        // Google push notifications are normally header-only
      }
    }

    const admin = createAdminClient()
    const result = await handleGoogleCalendarWebhook(admin, {
      channelId,
      channelToken,
      resourceState,
      mockEventPayloads,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({
      success: true,
      action: result.action,
      count: result.count ?? 0,
    })
  } catch (error) {
    console.error('[Google calendar webhook]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}