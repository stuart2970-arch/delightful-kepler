'use client';

export type OpenExternalUrlResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' };

export function openExternalSecureUrl(url: string): OpenExternalUrlResult {
  if (typeof window === 'undefined') return { ok: false, reason: 'popup_blocked' };
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    return { ok: false, reason: 'popup_blocked' };
  }
  try {
    opened.opener = null;
  } catch {
    // ignore
  }
  return { ok: true };
}

export function openNamedPopup(url: string, name: string, features: string): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open(url, name, features);
}