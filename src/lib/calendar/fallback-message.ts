export const SERVICE_NOT_FOUND_SPEECH = "I'm sorry, I couldn't find that specific service in our system. Could you tell me which service you'd like to book?";

export const NO_STAFF_SPEECH = "I'm sorry, no staff members are set up for online booking for that service. I can take your name, phone number, and a preferred time, and the salon will confirm.";

/**
 * Customer-facing reply when no live times can be offered.
 * A missing or unreachable calendar is never described as free time.
 */
export function calendarFallbackMessage(
  kind: 'none_connected' | 'unreachable',
  bookingUrl?: string | null
): string {
  const details = 'I can take your name, phone number, and a preferred time, and the salon will confirm.';
  const trimmedLink = bookingUrl?.trim();
  const link = trimmedLink ? ` You can also book here: ${trimmedLink}` : '';

  if (kind === 'none_connected') {
    return `I can't offer appointment times because there is no calendar connected. ${details}${link}`;
  }

  return `I can't reach the calendar just now, so I won't offer times that might already be taken. ${details}${link}`;
}

/**
 * Fixed speech for results that must not be rephrased into offered times.
 * Returns null when the model should present real slots.
 */
export function directAvailabilitySpeech(outcome: string, detailText: string): string | null {
  if (outcome === 'none_connected' || outcome === 'unreachable' || outcome === 'error') {
    return detailText;
  }
  if (outcome === 'service_not_found') return SERVICE_NOT_FOUND_SPEECH;
  if (outcome === 'no_staff') return NO_STAFF_SPEECH;
  return null;
}
