import { Inter, Poppins } from 'next/font/google'

// Turbopack CI dev server: one discrete weight per family (multi-weight arrays break startup).
export const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  preload: false,
})

export const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  preload: false,
})