/**
 * Deterministic font entry for Playwright and CI dev servers (STYL-408).
 * No next/font/google import, so Turbopack never resolves the Google font module.
 * Production layout still loads src/lib/fonts/index.ts.
 */
const stubFont = (variable: string) => ({
  variable,
  className: variable,
  style: { fontFamily: 'system-ui, sans-serif' },
})

export const poppins = stubFont('font-ci-poppins')
export const inter = stubFont('font-ci-inter')

export const rootFontClassName = `${poppins.variable} ${inter.variable} antialiased`
