const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  return Math.round((to - from) / 86400000)
}

export function isAtLeastDaysBefore(noticeDate: string, effectiveDate: string, days: number): boolean {
  if (!isIsoDate(noticeDate) || !isIsoDate(effectiveDate)) return false
  return daysBetween(noticeDate, effectiveDate) >= days
}

export function isFirstOfApril(iso: string): boolean {
  return /^\d{4}-04-01$/.test(iso) && isIsoDate(iso)
}

export function twelveMonthsBefore(aprilIso: string): string {
  const year = Number(aprilIso.slice(0, 4))
  return `${year - 1}-04-01`
}

export function startedAtLeastTwelveMonthsBefore(startedOn: string, aprilIso: string): boolean {
  if (!isIsoDate(startedOn) || !isFirstOfApril(aprilIso)) return false
  return startedOn <= twelveMonthsBefore(aprilIso)
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100
  if (!Number.isFinite(rounded)) return ''
  return `${rounded}%`
}

/**
 * Clause 4B.1. The Cap is CPI plus 2 percentage points, and never more than 8%.
 * A Cap of zero or less means there is no increase.
 */
export function annualPriceCapPercent(cpi12MonthPercent: number): number | null {
  if (!Number.isFinite(cpi12MonthPercent)) return null
  const roundedCpi = Math.round(cpi12MonthPercent * 100) / 100
  if (roundedCpi < -20 || roundedCpi > 30) return null
  const uncapped = Math.round((roundedCpi + 2) * 100) / 100
  if (uncapped <= 0) return 0
  return Math.min(uncapped, 8)
}

export function priceAfterCapPence(currentPence: number, capPercent: number): number | null {
  if (!Number.isInteger(currentPence) || currentPence < 0 || currentPence > 10_000_000) return null
  if (!Number.isFinite(capPercent) || capPercent < 0 || capPercent > 8) return null
  if (capPercent === 0) return currentPence
  const basisPoints = Math.round(capPercent * 100)
  return Math.round((currentPence * (10000 + basisPoints)) / 10000)
}

export function capExplanation(cpi12MonthPercent: number, capPercent: number): string {
  const cpi = formatPercent(cpi12MonthPercent)
  const uncapped = Math.round((Math.round(cpi12MonthPercent * 100) / 100 + 2) * 100) / 100
  const cap = formatPercent(capPercent)
  const worked = uncapped > 8
    ? `That comes to ${formatPercent(uncapped)}, which is more than 8%, so the Cap is ${cap}.`
    : `That comes to ${cap}. The Cap is never more than 8%.`
  return `The Cap is the 12-month rate of the Consumer Prices Index (CPI) last published by the Office for National Statistics before this notice (${cpi}), plus 2 percentage points. ${worked} We worked out the increase separately for the plan and each bolt-on, and rounded each new price to the nearest penny.`
}
