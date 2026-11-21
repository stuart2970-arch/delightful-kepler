const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape text for HTML body content (not attribute-safe alone for unquoted attrs). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch)
}

/** Escape for double-quoted HTML attribute values. */
export function escapeHtmlAttr(value: string): string {
  return escapeHtml(value)
}