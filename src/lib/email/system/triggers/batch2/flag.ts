/** Live batch 2 sends stay off until Stuart approves the templates. */
export function isBatch2SystemEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SYSTEM_EMAILS_BATCH2_ENABLED === 'true'
}
