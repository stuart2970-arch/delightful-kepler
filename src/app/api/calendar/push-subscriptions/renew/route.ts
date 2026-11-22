import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase-admin'
import { isInternalCronRequest } from '@/lib/telephony/release-vendors'
import { renewCalendarPushSubscriptions } from '@/lib/calendar/push-sync/renew-subscriptions'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isInternalCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const result = await renewCalendarPushSubscriptions(admin)
    return NextResponse.json({
      success: true,
      renewed: result.renewed,
      skipped: result.skipped,
      errors: result.errors,
      backfill: result.backfill,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Calendar push renew]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}