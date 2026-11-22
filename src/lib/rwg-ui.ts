/**
 * STYL-416. Reserve with Google stays hidden until the Actions Center
 * partnership is approved. Unset is off. This is a visibility switch, not a
 * secret: the server reads it and passes a boolean to the client.
 *
 * Feed routes under /api/rwg/feeds are unchanged. They only include tenants
 * with is_rwg_enabled. While this flag is off, the tenant settings API does
 * not write Reserve with Google columns, so the dashboard cannot start a feed.
 */
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function isRwgUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.RWG_UI_ENABLED ?? '').trim().toLowerCase()
  return ENABLED_VALUES.has(raw)
}
