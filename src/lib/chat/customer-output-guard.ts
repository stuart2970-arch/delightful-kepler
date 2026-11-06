/**
 * STYL-240: drop internal prompt, tool-protocol, and debug text before a
 * customer can see it or before it is saved to a transcript.
 * Patterns are code, not configuration. Keep them narrow so ordinary salon
 * replies ("book", "rule", "system", "tag") still pass through.
 */

export const CUSTOMER_UNFINISHED_REPLY =
  "I'm sorry, I couldn't finish that just now. Could you tell me again what you'd like to do?";

export const CUSTOMER_TROUBLE_REPLY =
  "I'm sorry, I'm having trouble right now. Please try again in a moment.";

export const INTERNAL_TEXT_PATTERNS: RegExp[] = [
  /secret tag/i,
  /\btag needed\b/i,
  /when outputting a/i,
  /must be the very last line/i,
  /CRITICAL (SCHEDULING )?RULE/i,
  /CRITICAL CONVERSATIONAL LAWS/i,
  /ABSOLUTE BAN/i,
  /STRICT BRAND PROTECTION RULE/i,
  /\[SYSTEM\]/,
  /\[INJECTED CHUNKS\]/,
  /SERVICES CONFIGURATION/,
  /STAFF CONFIGURATION/,
  /MANDATORY CHATBOT RULES/i,
  /system prompt/i,
  /\[DEBUG:/,
  /\[STREAM ERROR/,
  /Unexpected failure/i,
  /\[(CHECK_AVAILABILITY|BOOK_MEETING|TIME_SLOTS|LOOKUP_APPOINTMENTS|LEAD_CAPTURED)(\.\.\.|…)\]/,
];

const HOLD_CAP = 200;
const LOOKBEHIND = 64;

export type CustomerTextGuard = {
  push(chunk: string): string;
  finish(): string;
  readonly tripped: boolean;
};

function matchIndex(pattern: RegExp, text: string): number {
  const found = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(text);
  return found ? found.index : -1;
}

function findFirstMatch(text: string): { index: number } | null {
  let best = -1;
  for (const pattern of INTERNAL_TEXT_PATTERNS) {
    const index = matchIndex(pattern, text);
    if (index !== -1 && (best === -1 || index < best)) best = index;
  }
  return best === -1 ? null : { index: best };
}

export function containsInternalText(text: string): boolean {
  if (!text) return false;
  return findFirstMatch(text) !== null;
}

/** Start of the line or sentence that contains the match. Everything from here is dropped. */
function segmentStart(text: string, matchIndex: number): number {
  const lineBreak = text.lastIndexOf('\n', Math.max(0, matchIndex - 1));
  const lineStart = lineBreak === -1 ? 0 : lineBreak + 1;
  let sentenceStart = lineStart;
  for (let i = lineStart; i < matchIndex - 1; i++) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?') && text[i + 1] === ' ') {
      sentenceStart = i + 2;
    }
  }
  return sentenceStart;
}

export function sanitiseForTranscript(text: string): string {
  if (!text) return '';
  const match = findFirstMatch(text);
  if (!match) return text;
  return text.slice(0, segmentStart(text, match.index)).replace(/\s+$/, '');
}

function boundaryEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') return i + 1;
    if ((text[i] === '.' || text[i] === '!' || text[i] === '?') && text[i + 1] === ' ') {
      return i + 2;
    }
  }
  return -1;
}

/**
 * Streaming guard. Releases only at a newline, a sentence end (".", "!", "?"
 * plus a space), or a ~200 character hold cut back to whitespace. A pattern
 * split across chunks is still caught. Once tripped, later chunks are dropped.
 */
export function createCustomerTextGuard(): CustomerTextGuard {
  let buffer = '';
  let tripped = false;

  const releaseHeld = (): string => {
    let released = '';
    let end = boundaryEnd(buffer);
    while (end !== -1) {
      released += buffer.slice(0, end);
      buffer = buffer.slice(end);
      end = boundaryEnd(buffer);
    }
    if (buffer.length > HOLD_CAP) {
      const limit = buffer.length - LOOKBEHIND;
      if (limit > 0) {
        let cut = -1;
        for (let i = 0; i < limit; i++) {
          const ch = buffer[i];
          if (ch === ' ' || ch === '\n' || ch === '\t') cut = i + 1;
        }
        if (cut <= 0) cut = limit;
        released += buffer.slice(0, cut);
        buffer = buffer.slice(cut);
      }
    }
    return released;
  };

  return {
    get tripped() {
      return tripped;
    },
    push(chunk: string) {
      if (tripped || !chunk) return '';
      buffer += chunk;
      const match = findFirstMatch(buffer);
      if (match) {
        tripped = true;
        const prefix = buffer.slice(0, segmentStart(buffer, match.index));
        buffer = '';
        return prefix;
      }
      return releaseHeld();
    },
    finish() {
      if (tripped) return '';
      const match = findFirstMatch(buffer);
      if (match) {
        tripped = true;
        const prefix = buffer.slice(0, segmentStart(buffer, match.index));
        buffer = '';
        return prefix;
      }
      const out = buffer;
      buffer = '';
      return out;
    },
  };
}
