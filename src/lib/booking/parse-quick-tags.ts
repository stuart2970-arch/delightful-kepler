export type ManageRescheduleSlot = {
  start: string
  end: string
  time: string
  displayDate?: string
  staffId: string
  serviceId?: string
}

export type ManageRescheduleDay = {
  date: string
  displayDate: string
  slotsCount: number
}

function extractTagPayload(text: string, tagPrefix: string): string | null {
  const marker = `[${tagPrefix}:`
  const idx = text.indexOf(marker)
  if (idx === -1) return null
  let depth = 0
  let payload = ''
  const slice = text.slice(idx + marker.length)
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]
    payload += ch
    if (ch === '[') depth += 1
    if (ch === ']') {
      if (depth === 0) {
        return payload.slice(0, -1).trim()
      }
      depth -= 1
    }
  }
  return null
}

export function parseQuickTimesTag(tag: string | undefined | null): ManageRescheduleSlot[] {
  if (!tag) return []
  const payload = extractTagPayload(tag, 'QUICK_TIMES') ?? tag.replace(/^\[QUICK_TIMES:\s*/, '').replace(/\]\s*$/, '')
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload) as ManageRescheduleSlot[] | { slots?: ManageRescheduleSlot[] }
    if (Array.isArray(parsed)) {
      return parsed.flatMap((entry) => {
        if (entry && typeof entry === 'object' && 'slots' in entry && Array.isArray(entry.slots)) {
          return entry.slots as ManageRescheduleSlot[]
        }
        return [entry as ManageRescheduleSlot]
      })
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.slots)) {
      return parsed.slots
    }
  } catch {
    return []
  }
  return []
}

export function parseQuickDaysTag(tag: string | undefined | null): ManageRescheduleDay[] {
  if (!tag) return []
  const payload = extractTagPayload(tag, 'QUICK_DAYS') ?? tag.replace(/^\[QUICK_DAYS:\s*/, '').replace(/\]\s*$/, '')
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload) as Array<{ days?: ManageRescheduleDay[] }> | ManageRescheduleDay[]
    if (Array.isArray(parsed) && parsed.length > 0 && 'days' in (parsed[0] || {})) {
      return parsed.flatMap((group) => group.days || [])
    }
    return parsed as ManageRescheduleDay[]
  } catch {
    return []
  }
}