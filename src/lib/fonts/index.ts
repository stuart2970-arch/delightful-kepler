import * as playwrightFonts from './root-fonts-playwright'
import * as productionFonts from './root-fonts-production'

const usePlaywrightFonts = process.env.PLAYWRIGHT_TEST === 'true'

export const poppins = usePlaywrightFonts ? playwrightFonts.poppins : productionFonts.poppins
export const inter = usePlaywrightFonts ? playwrightFonts.inter : productionFonts.inter

export const rootFontClassName = usePlaywrightFonts
  ? `${playwrightFonts.poppins.variable} ${playwrightFonts.inter.variable} antialiased`
  : `${productionFonts.poppins.variable} ${productionFonts.inter.variable} antialiased`