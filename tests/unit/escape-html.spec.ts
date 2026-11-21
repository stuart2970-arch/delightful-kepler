import { test, expect } from '@playwright/test'
import { escapeHtml, escapeHtmlAttr } from '../../src/lib/email/escape-html'

test.describe('escapeHtml', () => {
  test('escapes script injection in HTML bodies', () => {
    const raw = '<img src=x onerror=alert(1)> & "test"'
    expect(escapeHtml(raw)).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;test&quot;',
    )
  })

  test('escapeHtmlAttr matches escapeHtml for quotes', () => {
    expect(escapeHtmlAttr(`a"b`)).toBe('a&quot;b')
  })
})