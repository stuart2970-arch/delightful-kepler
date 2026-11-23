/**
 * STYL-371. Visitor terms and privacy pages stay off until this is exactly `true`.
 * Unset, false, TRUE, 1, and any other value stay off. Not a secret.
 */

const FLAG = 'VISITOR_LEGAL_PAGES_ENABLED'

export function visitorLegalPagesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[FLAG] === 'true'
}
