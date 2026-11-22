import { NextRequest, NextResponse } from 'next/server'
import { withSuperAdmin } from '@/lib/auth/require-superadmin'
import { closeAccountNotABusiness, declineSignup } from '@/lib/email/system/triggers/batch2/decline-and-close'
import { sendAnnualPriceRiseNotice, sendOtherPriceRiseNotice, type PriceLineInput } from '@/lib/email/system/triggers/batch2/price-rise'

export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function prices(value: unknown, withNext: boolean): PriceLineInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rows: PriceLineInput[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const row = entry as { label?: unknown; currentPence?: unknown; newPence?: unknown }
    if (typeof row.label !== 'string' || typeof row.currentPence !== 'number') return null
    if (withNext && typeof row.newPence !== 'number') return null
    rows.push({
      label: row.label,
      currentPence: row.currentPence,
      newPence: typeof row.newPence === 'number' ? row.newPence : undefined,
    })
  }
  return rows
}

export const POST = withSuperAdmin(async (req: NextRequest) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 })
  }

  const action = text(body.action)
  const tenantId = text(body.tenantId)
  const noticeDate = text(body.noticeDate) || undefined

  if (action === 'decline-signup') {
    if (body.amountPaidPence !== undefined && body.amountPaidPence !== null && typeof body.amountPaidPence !== 'number') {
      return NextResponse.json({ error: 'The amount paid must be a whole number of pence.' }, { status: 400 })
    }
    const result = await declineSignup({
      tenantId,
      reasonCode: text(body.reasonCode),
      amountPaidPence: typeof body.amountPaidPence === 'number' ? body.amountPaidPence : undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ refund: result.refund, email: result.email })
  }

  if (action === 'close-not-a-business') {
    if (body.unusedPeriodPence !== undefined && body.unusedPeriodPence !== null && typeof body.unusedPeriodPence !== 'number') {
      return NextResponse.json({ error: 'The unused period amount must be a whole number of pence.' }, { status: 400 })
    }
    const result = await closeAccountNotABusiness({
      tenantId,
      unusedPeriodPence: typeof body.unusedPeriodPence === 'number' ? body.unusedPeriodPence : undefined,
      unusedPeriodEnds: text(body.unusedPeriodEnds) || undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ refund: result.refund, email: result.email })
  }

  if (action === 'annual-price-rise') {
    const lines = prices(body.prices, false)
    if (!lines || typeof body.cpi12MonthPercent !== 'number') {
      return NextResponse.json({ error: 'The CPI rate and the current prices are required.' }, { status: 400 })
    }
    const result = await sendAnnualPriceRiseNotice({
      tenantId,
      subscriptionStartedOn: text(body.subscriptionStartedOn),
      effectiveDate: text(body.effectiveDate),
      cpi12MonthPercent: body.cpi12MonthPercent,
      prices: lines,
      noticeDate,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ email: result.email, dashboardNotice: result.dashboardNotice })
  }

  if (action === 'other-price-rise') {
    const lines = prices(body.prices, true)
    if (!lines || typeof body.howWorkedOut !== 'string') {
      return NextResponse.json({ error: 'The new prices and how they were worked out are required.' }, { status: 400 })
    }
    const result = await sendOtherPriceRiseNotice({
      tenantId,
      effectiveDate: text(body.effectiveDate),
      howWorkedOut: body.howWorkedOut,
      prices: lines,
      noticeDate,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ email: result.email, dashboardNotice: result.dashboardNotice })
  }

  return NextResponse.json({ error: 'That account action is not available.' }, { status: 400 })
})
