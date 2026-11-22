import type * as PlaywrightFonts from './root-fonts-playwright'
import type * as ProductionFonts from './root-fonts-production'

// Turbopack CI dev server: load only one next/font module. Static imports of both
// families make Turbopack resolve multi-weight production fonts during Playwright runs.
const fonts: typeof PlaywrightFonts | typeof ProductionFonts =
  process.env.PLAYWRIGHT_TEST === 'true'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./root-fonts-playwright')
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./root-fonts-production')

export const poppins = fonts.poppins
export const inter = fonts.inter

export const rootFontClassName = `${fonts.poppins.variable} ${fonts.inter.variable} antialiased`