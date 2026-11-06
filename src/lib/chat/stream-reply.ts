/**
 * STYL-233: customer-visible chat replies must finish on a complete sentence.
 *
 * The chat route used to call streamText with maxOutputTokens 1024 and no
 * thinking setting, then forward whatever text arrived. On Gemini 3.6 Flash
 * the installed @ai-sdk/google v3 exposes thinkingConfig.thinkingLevel.
 * A low level keeps reasoning from crowding out the visible reply, and
 * maxOutputTokens is large enough that the visible reply still has at least
 * 2048 tokens if some of the budget is spent on thinking.
 */

import {
  containsInternalText,
  createCustomerTextGuard,
  type CustomerTextGuard,
} from '@/lib/chat/customer-output-guard';
import { splitAtToolTag, visibleLength } from '@/lib/calendar/tool-tags';

export const INCOMPLETE_REPLY_SUFFIX =
  "Sorry, I didn't get to finish that. Could you ask me again?";

export const BOOKING_UNCONFIRMED_SUFFIX =
  "I haven't been able to confirm that booking yet. Shall I try again?";

export const CHAT_MODEL_TIMEOUT_MS = 25_000;
export const CHAT_CALENDAR_TIMEOUT_MS = 10_000;
/** Whole reply, including one model pass and a calendar call, stays inside this. */
export const CHAT_REPLY_DEADLINE_MS = 35_000;

export const CHAT_GENERATION_SETTINGS = {
  maxOutputTokens: 4096,
  providerOptions: {
    google: {
      thinkingConfig: {
        thinkingLevel: 'low' as const,
      },
    },
  },
};

export function resolvePositiveMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'DeadlineError';
  }
}

export async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
      promise.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type UsageSummary = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};

export function summariseUsage(usage: unknown): UsageSummary | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const details = record.outputTokenDetails;
  const detailReasoning = details && typeof details === 'object'
    ? (details as Record<string, unknown>).reasoningTokens
    : undefined;
  const reasoning = typeof detailReasoning === 'number'
    ? detailReasoning
    : typeof record.reasoningTokens === 'number'
      ? record.reasoningTokens
      : undefined;
  return {
    inputTokens: typeof record.inputTokens === 'number' ? record.inputTokens : undefined,
    outputTokens: typeof record.outputTokens === 'number' ? record.outputTokens : undefined,
    totalTokens: typeof record.totalTokens === 'number' ? record.totalTokens : undefined,
    reasoningTokens: reasoning,
  };
}

const BULLET_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/;

function isBulletLine(line: string): boolean {
  return BULLET_LINE.test(line);
}

/** A reply the customer can be left with: it already ends on a sentence or a finished bullet. */
export function isCompleteCustomerReply(text: string): boolean {
  if (!text.trim()) return true;
  const trimmed = text.trimEnd();
  if (/[.!?]["')\]]*$/.test(trimmed)) return true;
  if (text.endsWith('\n')) {
    const lines = trimmed.split('\n');
    const last = lines[lines.length - 1] ?? '';
    if (isBulletLine(last)) return true;
  }
  return false;
}

function trimToLastCompleteBoundary(text: string): string {
  let lastEnd = 0;
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const newlineFollows = i < lines.length - 1 || text.endsWith('\n');
    const lineStart = offset;
    const sentence = /[.!?]["')\]]*(?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sentence.exec(line))) {
      lastEnd = lineStart + match.index + match[0].length;
    }
    const lineEnd = lineStart + line.length;
    if (newlineFollows && isBulletLine(line)) {
      const end = lineEnd + 1;
      if (end > lastEnd) lastEnd = end;
    }
    offset = lineEnd + (i < lines.length - 1 ? 1 : 0);
  }
  return text.slice(0, lastEnd);
}

function removeUnpairedBold(text: string): string {
  const marks = text.match(/\*\*/g);
  if (!marks || marks.length % 2 === 0) return text;
  const index = text.lastIndexOf('**');
  return text.slice(0, index) + text.slice(index + 2);
}

export type FinalisedReply = {
  text: string;
  suffix: string;
};

/**
 * Trims a cut-short reply back to the last complete sentence or bullet line,
 * drops an unpaired ** marker, and returns the suffix to append.
 * A reply that already ends cleanly is returned unchanged when cutShort is false.
 */
export function finaliseVisibleReply(
  visibleText: string,
  options?: { cutShort?: boolean; suffix?: string },
): FinalisedReply {
  const suffix = options?.suffix ?? INCOMPLETE_REPLY_SUFFIX;
  const cutShort = options?.cutShort ?? false;
  if (!cutShort && isCompleteCustomerReply(visibleText)) {
    return { text: visibleText, suffix: '' };
  }
  const trimmed = removeUnpairedBold(trimToLastCompleteBoundary(visibleText)).replace(/\s+$/, '');
  return { text: trimmed, suffix };
}

export function joinFinalised(result: FinalisedReply): string {
  const text = result.text.replace(/\s+$/, '');
  if (!result.suffix) return result.text;
  if (!text) return result.suffix;
  const separator = text.includes('\n') ? '\n' : ' ';
  return `${text}${separator}${result.suffix}`;
}

/** What still needs to be enqueued so the customer ends on the finalised reply. */
export function unsentFinalised(enqueued: string, visible: string, suffix: string): string {
  const rendered = joinFinalised(finaliseVisibleReply(visible, { cutShort: true, suffix }));
  if (rendered.startsWith(enqueued)) return rendered.slice(enqueued.length);
  if (suffix && enqueued.includes(suffix)) return '';
  if (!suffix) return '';
  return `${enqueued && !/\s$/.test(enqueued) ? ' ' : ''}${suffix}`;
}

const ANNOUNCED_CHECK =
  /\b(let me check|i(?:'|’)ll check|i will check|i(?:'|’)m checking|\bchecking\b|i(?:'|’)ll look|i will look|let me look|let me see|i(?:'|’)ll see)\b/i;

export function announcesAvailabilityCheck(text: string): boolean {
  return ANNOUNCED_CHECK.test(text);
}

const BOOKING_CLAIM =
  /\b(i have booked|i(?:'|’)ve booked|booked your|you(?:'|’)re booked|you are booked|booking is confirmed|appointment is confirmed|i have confirmed your (?:booking|appointment))\b/i;

export function claimsBookingDone(text: string): boolean {
  return BOOKING_CLAIM.test(text);
}

export function formatBookingConfirmation(input: {
  service: string;
  staff?: string | null;
  displayDate: string;
  time: string;
  email: string;
}): string {
  const staff = input.staff?.trim();
  const withStaff = staff ? ` with ${staff}` : '';
  return `Your ${input.service}${withStaff} is confirmed for ${input.displayDate} at ${input.time}. A confirmation email has been sent to ${input.email}.`;
}

export type PipeReplyInput = {
  textStream: AsyncIterable<string> | Iterable<string>;
  finishReason?: PromiseLike<string> | string;
  usage?: PromiseLike<unknown>;
  timeoutMs?: number;
  enqueue: (text: string) => void;
  guard?: CustomerTextGuard;
  /** When false, an unfinished tail is left in `pending` for the caller to replace. */
  finalise?: boolean;
};

export type PipeReplyResult = {
  rawText: string;
  visibleText: string;
  pending: string;
  enqueuedText: string;
  finishReason: string;
  timedOut: boolean;
  cutShort: boolean;
  tripped: boolean;
  usage: UsageSummary | null;
};

function iteratorOf(source: AsyncIterable<string> | Iterable<string>): AsyncIterator<string> {
  const asyncSource = source as AsyncIterable<string>;
  if (typeof asyncSource[Symbol.asyncIterator] === 'function') {
    return asyncSource[Symbol.asyncIterator]();
  }
  const sync = (source as Iterable<string>)[Symbol.iterator]();
  return {
    next() {
      return Promise.resolve(sync.next());
    },
  };
}

function nextWithTimeout(
  iterator: AsyncIterator<string>,
  ms: number,
): Promise<IteratorResult<string> | 'timeout'> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, ms);
    iterator.next().then(
      (step) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(step);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function stoppedEarly(finishReason: string, timedOut: boolean, visible: string): boolean {
  if (!visible.trim()) return false;
  if (timedOut) return true;
  // A normal stop is the model's chosen ending. Only an early stop is rewritten.
  return finishReason === 'length'
    || finishReason === 'error'
    || finishReason === 'content-filter'
    || finishReason === 'other';
}

/**
 * Reads a model stream with the STYL-198 tool-tag holdback first, then the
 * STYL-240 leak guard. A length cap or a timeout trims the visible reply.
 */
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === 'function';
}

/**
 * Attach a rejection handler before the caller awaits. A failed model call
 * rejects every result promise, and an unhandled rejection takes down the dev server.
 */
export function guardStreamPromise<T>(promise: PromiseLike<T> | undefined, fallback: T): Promise<T> | undefined {
  if (!isPromiseLike<T>(promise)) return undefined;
  return Promise.resolve(promise).then((value) => value, () => fallback);
}

/** A failed model call rejects every unread result promise. */
export function settleUnreadStreamResult(result: object | null | undefined) {
  if (!result) return;
  for (const key of ['text', 'totalUsage', 'response', 'content', 'reasoning', 'reasoningText', 'providerMetadata', 'steps', 'sources', 'files', 'warnings']) {
    const value = (result as Record<string, unknown>)[key];
    if (isPromiseLike(value)) value.then(() => undefined, () => undefined);
  }
}

export async function pipeReply(input: PipeReplyInput): Promise<PipeReplyResult> {
  const timeoutMs = input.timeoutMs ?? CHAT_MODEL_TIMEOUT_MS;
  const guard = input.guard ?? createCustomerTextGuard();
  const started = Date.now();
  const iterator = iteratorOf(input.textStream);
  let raw = '';
  let shown = 0;
  let enqueued = '';
  let timedOut = false;

  const enqueue = (piece: string) => {
    if (!piece) return;
    input.enqueue(piece);
    enqueued += piece;
  };

  const emitSafe = (piece: string) => {
    if (!piece || guard.tripped) return;
    enqueue(guard.push(piece));
  };

  const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));

  try {
    while (true) {
      const wait = remaining();
      if (wait <= 0) {
        timedOut = true;
        break;
      }
      const step = await nextWithTimeout(iterator, wait);
      if (step === 'timeout') {
        timedOut = true;
        break;
      }
      if (step.done) break;
      const chunk = typeof step.value === 'string' ? step.value : String(step.value ?? '');
      raw += chunk;
      const safeLength = visibleLength(raw);
      if (safeLength > shown) {
        emitSafe(raw.slice(shown, safeLength));
        shown = safeLength;
      }
    }
  } catch (err) {
    if (!isAbortError(err)) throw err;
    timedOut = true;
  }

  let finishReason = timedOut ? 'timeout' : 'stop';
  if (input.finishReason !== undefined) {
    const grace = timedOut ? 200 : Math.min(1_000, Math.max(remaining(), 1));
    try {
      const resolved = await withDeadline(Promise.resolve(input.finishReason), grace, 'Model finish reason');
      if (typeof resolved === 'string' && resolved) finishReason = resolved;
    } catch (err) {
      if (err instanceof DeadlineError) {
        if (timedOut) finishReason = 'timeout';
        else finishReason = 'unknown';
      } else if (!timedOut) {
        throw err;
      }
    }
  }

  let usage: UsageSummary | null = null;
  if (input.usage !== undefined && !timedOut) {
    try {
      usage = summariseUsage(await withDeadline(
        Promise.resolve(input.usage),
        Math.min(500, Math.max(remaining(), 50)),
        'Model usage',
      ));
    } catch {
      usage = null;
    }
  }

  let pending = '';
  if (!guard.tripped) {
    const before = splitAtToolTag(raw).before;
    if (before.length > shown) pending += guard.push(before.slice(shown));
    pending += guard.finish();
  }

  const fullVisible = enqueued + pending;
  const cutShort = !guard.tripped && stoppedEarly(finishReason, timedOut, fullVisible);
  const shouldFinalise = input.finalise !== false;

  if (shouldFinalise && cutShort) {
    enqueue(unsentFinalised(enqueued, fullVisible, INCOMPLETE_REPLY_SUFFIX));
    pending = '';
  } else if (shouldFinalise && pending) {
    enqueue(pending);
    pending = '';
  }

  return {
    rawText: raw,
    visibleText: shouldFinalise ? enqueued : fullVisible,
    pending: shouldFinalise ? '' : pending,
    enqueuedText: enqueued,
    finishReason,
    timedOut,
    cutShort,
    tripped: guard.tripped || containsInternalText(raw),
    usage,
  };
}
