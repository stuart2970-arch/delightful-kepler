/**
 * Playwright / CI dev server: avoid next/font/google (Turbopack can fail to resolve
 * @vercel/turbopack-next/internal/font/google under parallel route compilation).
 * Layout only needs `.variable` class tokens; globals.css already falls back to
 * system/Poppins stacks when CSS variables are unset.
 */
export const poppins = { variable: 'font-poppins-playwright-stub' as const }

export const inter = { variable: 'font-inter-playwright-stub' as const }