import { test, expect } from '@playwright/test';
import { buildBrandedEmailHtml } from '../../src/lib/email/branded-email-layout';
import { publicAppPath } from '../../src/lib/env/public-app-url';

test.describe('lead notifier HTML (STYL-271)', () => {
  test('dashboard CTA uses publicAppPath origin', () => {
    const dashboardUrl = publicAppPath('/dashboard', {
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
      NODE_ENV: 'test',
    });
    const html = buildBrandedEmailHtml({
      title: 'New Lead Captured',
      bodyHtml: '<p>Test body</p>',
      ctaHref: dashboardUrl,
      ctaLabel: 'View in StyleFlo Dashboard',
    });
    expect(html).toContain(`href="${dashboardUrl}"`);
    expect(html).not.toContain('https://app.styleflo.ai');
  });
});