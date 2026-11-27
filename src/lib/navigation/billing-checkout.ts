'use client';

import { dashboardFetch } from '../auth/dashboard-auth-headers';
import { embeddedReturnUrl } from '../env/embed-context';
import { openExternalSecureUrl } from './external-url';
import { DASHBOARD_SESSION_EXPIRED_MESSAGE } from '../auth/dashboard-session-expired';

export type BillingCheckoutOpenResult =
  | { ok: true }
  | { ok: false; error: string; checkoutUrl?: string; sessionExpired?: boolean };

export async function postBillingCheckout(body: Record<string, unknown>): Promise<Response> {
  return dashboardFetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function dashboardReturnUrl(pathWithQuery: string): string {
  return embeddedReturnUrl(pathWithQuery);
}

export async function openBillingCheckoutFromApi(
  body: Record<string, unknown>,
): Promise<BillingCheckoutOpenResult> {
  const response = await postBillingCheckout(body);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    return {
      ok: false,
      error: DASHBOARD_SESSION_EXPIRED_MESSAGE,
      sessionExpired: true,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: typeof data.error === 'string' && data.error ? data.error : 'Checkout failed. Please try again.',
    };
  }
  const url = typeof data.url === 'string' ? data.url : '';
  if (!url) {
    return { ok: false, error: 'No checkout URL received from payment provider.' };
  }
  const opened = openExternalSecureUrl(url);
  if (!opened.ok) {
    return {
      ok: false,
      error: 'Pop-up blocked. Continue to secure checkout using the link below.',
      checkoutUrl: url,
    };
  }
  return { ok: true };
}