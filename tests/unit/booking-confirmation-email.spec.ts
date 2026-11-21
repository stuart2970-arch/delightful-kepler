import { test, expect } from '@playwright/test'
import { escapeHtml } from '../../src/lib/email/escape-html'

test('booking confirmation HTML escapes customer-controlled fields', () => {
  const payload = escapeHtml('<script>alert(1)</script>')
  expect(payload).not.toContain('<script>')
  expect(payload).toContain('&lt;script&gt;')
})