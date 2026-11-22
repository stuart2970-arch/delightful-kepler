/**
 * STYL-264 batch 3 stays off until this is exactly "true".
 * Unset, empty, and any other value do not send.
 */
export function isSystemEmailsBatch3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYSTEM_EMAILS_BATCH3_ENABLED === 'true'
}
