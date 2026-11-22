const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function systemEmailStringData(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    if (!key.trim() || key.length > 80) continue
    data[key] = value
  }
  return data
}

export function isSystemEmailAddress(value: string): boolean {
  if (value !== value.trim()) return false
  if (value.length > 320) return false
  if (/[\r\n\u0000]/.test(value)) return false
  return EMAIL_PATTERN.test(value)
}

export function isSystemEmailIdempotencyKey(value: string): boolean {
  if (value.length < 1 || value.length > 200) return false
  return !/[\r\n\u0000]/.test(value)
}

export function isSystemEmailTenantId(value: string): boolean {
  return UUID_PATTERN.test(value)
}
