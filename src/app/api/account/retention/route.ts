import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenantRole } from '@/lib/auth/require-tenant-role'
import {
  ACCOUNT_RECORD_RETENTION_MAX_DAYS,
  MESSAGE_RETENTION_MAX_DAYS,
  parseRetentionDays,
  type RetentionSetting,
} from '@/lib/account/retention'

export const dynamic = 'force-dynamic'

const adminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const toSetting = (row: { account_record_retention_days: number; message_retention_days: number }): RetentionSetting => ({
  accountRecordRetentionDays: row.account_record_retention_days,
  messageRetentionDays: row.message_retention_days,
  accountRecordRetentionMaximumDays: ACCOUNT_RECORD_RETENTION_MAX_DAYS,
  messageRetentionMaximumDays: MESSAGE_RETENTION_MAX_DAYS,
})

export async function GET(req: NextRequest) {
  const auth = await requireTenantRole(req, ['owner', 'admin'])
  if (!auth.ok) return auth.response
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const { data, error } = await admin
    .from('tenants')
    .select('account_record_retention_days, message_retention_days')
    .eq('id', auth.tenantId)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Could not load retention settings.' }, { status: 500 })
  return NextResponse.json(toSetting(data))
}

export async function PATCH(req: NextRequest) {
  const auth = await requireTenantRole(req, ['owner', 'admin'])
  if (!auth.ok) return auth.response
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  let body: { accountRecordRetentionDays?: unknown; messageRetentionDays?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const accountDays = parseRetentionDays(body.accountRecordRetentionDays, ACCOUNT_RECORD_RETENTION_MAX_DAYS)
  const messageDays = parseRetentionDays(body.messageRetentionDays, MESSAGE_RETENTION_MAX_DAYS)
  if (accountDays === null || messageDays === null) {
    return NextResponse.json({
      error: 'Retention can be 1 to 365 days for account records and 1 to 90 days for messages. It cannot be lengthened past those limits.',
    }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tenants')
    .update({
      account_record_retention_days: accountDays,
      message_retention_days: messageDays,
    })
    .eq('id', auth.tenantId)
    .select('account_record_retention_days, message_retention_days')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({
      error: 'Retention can only be shortened. The current periods were left unchanged.',
    }, { status: 409 })
  }
  return NextResponse.json(toSetting(data))
}
