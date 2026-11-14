/**
 * Dashboard API calls attach a Bearer access token that is still valid.
 * supabase.auth.getSession() returns the stored session, and that access
 * token can already be expired (or inside the last minute of its life).
 * Sending it makes requireUser and the chatbot routes reject a signed-in owner.
 */
import { getSupabaseBrowserClient, hasSupabaseBrowserEnv } from '../supabase-browser';

export const DASHBOARD_AUTH_REFRESH_SKEW_SECONDS = 60;

export interface DashboardAccessSession {
  access_token?: string;
  expires_at?: number | null;
}

export interface DashboardAuthClient {
  auth: {
    getSession: () => Promise<{
      data: { session: DashboardAccessSession | null };
      error: { message?: string } | null;
    }>;
    refreshSession: () => Promise<{
      data: { session: DashboardAccessSession | null };
      error: { message?: string } | null;
    }>;
    onAuthStateChange?: (
      callback: (event: string, session: DashboardAccessSession | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
  };
}

const SESSION_WAIT_MS = 5000;

/**
 * getSession() is empty until the browser client finishes reading storage.
 * Right after login that race sends dashboard GETs with no Bearer token.
 * INITIAL_SESSION fires once storage has been read.
 */
export async function waitForAuthSession(client: DashboardAuthClient): Promise<void> {
  const listen = client.auth.onAuthStateChange;
  if (!listen) return;
  try {
    const first = await client.auth.getSession();
    if (first.data?.session?.access_token) return;
  } catch {
    // The initial event below is the source of truth.
  }
  await new Promise<void>((resolve) => {
    const state: {
      settled: boolean;
      timer?: ReturnType<typeof setTimeout>;
      unsubscribe?: () => void;
    } = { settled: false };
    const finish = () => {
      if (state.settled) return;
      state.settled = true;
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.unsubscribe?.();
      resolve();
    };
    const { data } = listen((event, session) => {
      if (session?.access_token || event === 'INITIAL_SESSION') finish();
    });
    state.unsubscribe = () => data.subscription.unsubscribe();
    if (state.settled) state.unsubscribe();
    else state.timer = setTimeout(finish, SESSION_WAIT_MS);
  });
}

export function readJwtExp(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Earlier of the session expiry and the JWT exp claim. Null when neither is known. */
export function earliestExpiry(session: DashboardAccessSession): number | null {
  const fromField = typeof session.expires_at === 'number' ? session.expires_at : null;
  const fromJwt = session.access_token ? readJwtExp(session.access_token) : null;
  if (fromField === null) return fromJwt;
  if (fromJwt === null) return fromField;
  return Math.min(fromField, fromJwt);
}

export function accessTokenNeedsRefresh(
  expiresAt: number | null,
  nowSeconds: number,
  skewSeconds = DASHBOARD_AUTH_REFRESH_SKEW_SECONDS,
): boolean {
  if (expiresAt === null) return true;
  return expiresAt - nowSeconds <= skewSeconds;
}

export async function getFreshAccessToken(
  client: DashboardAuthClient,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  let session: DashboardAccessSession | null = null;
  try {
    const { data, error } = await client.auth.getSession();
    session = data?.session ?? null;
    if (error && !session?.access_token) return null;
  } catch {
    return null;
  }
  if (!session?.access_token) return null;

  const expiresAt = earliestExpiry(session);
  if (!accessTokenNeedsRefresh(expiresAt, nowSeconds)) {
    return session.access_token;
  }

  try {
    const refreshed = await client.auth.refreshSession();
    const next = refreshed.data?.session;
    if (!refreshed.error && next?.access_token && !accessTokenNeedsRefresh(earliestExpiry(next), nowSeconds)) {
      return next.access_token;
    }
  } catch {
    // Fall through and keep a token that has not actually expired yet.
  }

  if (expiresAt !== null && expiresAt > nowSeconds) {
    return session.access_token;
  }
  return null;
}

function resolveDashboardAuthClient(client?: DashboardAuthClient | null): DashboardAuthClient | null {
  if (client) return client;
  if (client === null) return null;
  if (typeof window === 'undefined') return null;
  if (!hasSupabaseBrowserEnv()) return null;
  return getSupabaseBrowserClient();
}

export async function getDashboardAuthHeaders(
  baseHeaders: Record<string, string> = {},
  client?: DashboardAuthClient | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...baseHeaders };
  const auth = resolveDashboardAuthClient(client);
  if (!auth) return headers;
  try {
    await waitForAuthSession(auth);
    const token = await getFreshAccessToken(auth);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (err) {
    console.warn('Could not retrieve a fresh session for the dashboard auth header:', err);
  }
  return headers;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Same-origin dashboard fetch with a fresh Bearer token.
 * Cookies are still sent by the browser. The header covers routes whose
 * cookie session is missing or stale.
 */
export async function dashboardFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  client?: DashboardAuthClient | null,
): Promise<Response> {
  const headers = await getDashboardAuthHeaders(headersToRecord(init.headers), client);
  return fetch(input, { ...init, headers });
}
