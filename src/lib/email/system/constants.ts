/** Reply-To on every system email. Callers cannot override it. */
export const SYSTEM_EMAIL_REPLY_TO = 'support@styleflo.ai'

export const SYSTEM_EMAIL_FROM_NAME = 'StyleFlo'

/**
 * Addresses that may receive system email when the app is not in production.
 * Production (APP_ENV=production, or NODE_ENV=production when APP_ENV is unset)
 * is not limited to this list.
 */
export const NON_PRODUCTION_SYSTEM_EMAIL_RECIPIENTS = [
  'test999@styleflo.ai',
  'stuart.magowan.sharp@gmail.com',
] as const

export const EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY = 'system.test.example'

export const MOCK_SYSTEM_EMAIL_PROVIDER_PREFIX = 'playwright-mock-'
