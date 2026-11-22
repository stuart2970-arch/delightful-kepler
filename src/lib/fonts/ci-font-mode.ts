/**
 * STYL-408: Playwright and CI dev servers must not compile next/font/google.
 * Parallel Turbopack jobs flake on @vercel/turbopack-next/internal/font/google/font
 * and on multi-weight Google font bundles.
 *
 * Production `next build` sets NODE_ENV=production (Docker and App Hosting).
 * That path keeps the real font module even if a runner also exports CI.
 */
export const deterministicCiFontsEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (env.NODE_ENV === 'production') return false
  const playwright = env.PLAYWRIGHT_TEST === 'true'
  const ci = env.CI === 'true' || env.CI === '1'
  return playwright || ci
}
