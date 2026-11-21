export interface BrandedEmailLayoutOptions {
  title: string;
  subtitle?: string;
  bodyHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
}

/**
 * Shared HTML shell for transactional emails (lead notifications, booking alerts, etc.).
 */
export function buildBrandedEmailHtml(options: BrandedEmailLayoutOptions): string {
  const { title, subtitle, bodyHtml, ctaHref, ctaLabel } = options;
  const ctaBlock =
    ctaHref && ctaLabel
      ? `<div style="text-align: center; margin-top: 28px;">
      <a href="${ctaHref}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">${ctaLabel}</a>
    </div>`
      : '';

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); padding: 24px; text-align: center; color: #ffffff;">
    <h2 style="margin: 0; font-size: 22px; font-weight: 700;">${title}</h2>
    ${subtitle ? `<p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">${subtitle}</p>` : ''}
  </div>
  <div style="padding: 24px;">
    ${bodyHtml}
    ${ctaBlock}
  </div>
</div>`.trim();
}