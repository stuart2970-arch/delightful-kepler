const TOOL_TAG_MARKERS = ['[CHECK_AVAILABILITY', '[BOOK_MEETING', '[LOOKUP_APPOINTMENTS'];
const AVAILABILITY_MARKER = '[CHECK_AVAILABILITY';

/**
 * Index where a server-side tool tag starts, or -1.
 * Tool tags are instructions for the server, never text for the customer.
 */
export function findToolTagStart(text: string): number {
  let first = -1;
  for (const marker of TOOL_TAG_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (first === -1 || idx < first)) first = idx;
  }
  return first;
}

/**
 * How much of a partly streamed reply is safe to show the customer.
 * Stops before any tool tag, and holds back a trailing "[" that could still grow into one.
 */
export function visibleLength(text: string): number {
  const tagStart = findToolTagStart(text);
  if (tagStart !== -1) return tagStart;

  const lastOpen = text.lastIndexOf('[');
  if (lastOpen !== -1) {
    const tail = text.slice(lastOpen);
    if (TOOL_TAG_MARKERS.some((marker) => marker.startsWith(tail))) return lastOpen;
  }
  return text.length;
}

/**
 * Splits a finished reply into the customer-facing text and whether a tool tag followed it.
 * A lone "[" or "[X" at the very end is ordinary text.
 */
export function splitAtToolTag(text: string): { before: string; hadTag: boolean } {
  const start = findToolTagStart(text);
  if (start !== -1) return { before: text.slice(0, start), hadTag: true };

  const safe = visibleLength(text);
  if (text.length - safe >= 3) return { before: text.slice(0, safe), hadTag: true };
  return { before: text, hadTag: false };
}

/**
 * Reads what it can from a [CHECK_AVAILABILITY ...] tag the model did not finish.
 * Returns null when there is no such tag.
 */
export function parseTruncatedAvailabilityTag(text: string): { staffRef: string; serviceRef: string } | null {
  const idx = text.indexOf(AVAILABILITY_MARKER);
  if (idx === -1) {
    const lastOpen = text.lastIndexOf('[');
    const tail = lastOpen === -1 ? '' : text.slice(lastOpen);
    return tail.length >= 3 && AVAILABILITY_MARKER.startsWith(tail) ? { staffRef: '', serviceRef: '' } : null;
  }

  const parts = text
    .slice(idx + AVAILABILITY_MARKER.length)
    .replace(/^\s*:?\s*/, '')
    .split(',')
    .map((part) => part.replace(/['"\]]/g, '').trim());

  return { staffRef: parts[0] || '', serviceRef: parts[1] || '' };
}

/**
 * Finds the one item whose id equals or starts with a partial id.
 * Short or ambiguous fragments return null rather than guessing.
 */
export function resolveByIdPrefix<T extends { id: string }>(items: T[], ref: string): T | null {
  const cleaned = ref.trim().toLowerCase();
  if (cleaned.length < 4) return null;

  const exact = items.find((item) => item.id.toLowerCase() === cleaned);
  if (exact) return exact;

  const matches = items.filter((item) => item.id.toLowerCase().startsWith(cleaned));
  return matches.length === 1 ? matches[0] : null;
}
