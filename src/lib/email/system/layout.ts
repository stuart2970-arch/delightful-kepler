import { buildBrandedEmailHtml } from '@/lib/email/branded-email-layout'
import { escapeHtml } from '@/lib/email/escape-html'
import type { SystemEmailContent } from './types'

export type BrandedSystemEmailInput = {
  subject: string
  title?: string
  subtitle?: string
  paragraphs: string[]
  ctaHref?: string
  ctaLabel?: string
}

const SUPPORT_LINE = 'Reply to this email and it will reach StyleFlo support.'

/**
 * One StyleFlo-branded shell for system email. Paragraphs are plain text.
 * HTML is escaped. The shared layout supplies the visual template.
 */
export function renderBrandedSystemEmail(input: BrandedSystemEmailInput): SystemEmailContent {
  const paragraphs = [...input.paragraphs, SUPPORT_LINE].filter((paragraph) => paragraph.trim().length > 0)
  const text = paragraphs.join('\n\n')
  const bodyHtml = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
  return {
    subject: input.subject.replace(/[\r\n]+/g, ' ').trim(),
    text,
    html: buildBrandedEmailHtml({
      title: input.title?.trim() || 'StyleFlo',
      subtitle: input.subtitle,
      bodyHtml,
      ctaHref: input.ctaHref,
      ctaLabel: input.ctaLabel,
    }),
  }
}
