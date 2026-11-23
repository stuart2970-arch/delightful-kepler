/** New batch 4 notices stay off until this is exactly "true". */
export function isSystemEmailsBatch4Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYSTEM_EMAILS_BATCH4_ENABLED === 'true'
}

/**
 * Complaint forwards go to the monitored support inbox in production.
 * Other environments use the approved test inbox. The sending layer still
 * sets Reply-To to support@styleflo.ai.
 */
export function complaintForwardRecipient(env: NodeJS.ProcessEnv = process.env): string {
  const production = env.APP_ENV === 'production' || (env.NODE_ENV === 'production' && !env.APP_ENV)
  return production ? 'support@styleflo.ai' : 'test999@styleflo.ai'
}
