import { publicAppPath } from '@/lib/env/public-app-url'

export type CalendarPushProvider = 'google' | 'microsoft'

/** Live channel/subscription registration is staging-only until Stuart approves. */
export function calendarPushRegistrationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PLAYWRIGHT_TEST === 'true' || env.NODE_ENV === 'test') {
    return env.CALENDAR_PUSH_REGISTER_IN_TESTS === 'true'
  }
  return env.CALENDAR_PUSH_REGISTER_ENABLED === 'true'
}

export function calendarPushWebhookBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.CALENDAR_PUSH_WEBHOOK_BASE_URL || env.APP_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return publicAppPath('', env)
}

export function googleCalendarWebhookUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${calendarPushWebhookBaseUrl(env)}/api/webhooks/calendar/google`
}

export function microsoftCalendarWebhookUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${calendarPushWebhookBaseUrl(env)}/api/webhooks/calendar/microsoft`
}