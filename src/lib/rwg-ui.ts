/**
 * STYL-416. Reserve with Google stays hidden until the Actions Center
 * partnership is approved. Unset is off. This is a visibility switch, not a
 * secret: the server reads it and passes a boolean to the client.
 *
 * While this flag is off, /api/rwg/feeds/merchants, /services and /availability
 * return an empty list before any database query. /api/rwg/feeds/cron still
 * requires its bearer token, then returns without running the aggregation.
 */
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])

export function isRwgUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.RWG_UI_ENABLED ?? '').trim().toLowerCase()
  return ENABLED_VALUES.has(raw)
}

export function disabledRwgCronBody(now: Date = new Date()): {
  success: true
  message: string
  timestamp: string
} {
  return {
    success: true,
    message: 'Reserve with Google feeds are disabled.',
    timestamp: now.toISOString(),
  }
}
