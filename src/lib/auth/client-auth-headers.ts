import { getSupabaseBrowserClient, hasSupabaseBrowserEnv } from '@/lib/supabase-browser';

/**
 * Attach the signed-in dashboard session as a Bearer token.
 * Same-origin cookies are still sent by the browser; the header covers
 * the path the other dashboard fetches already use when cookies are missing.
 */
export async function browserAuthHeaders(
  baseHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (!hasSupabaseBrowserEnv()) return headers;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch (err) {
    console.warn('Could not retrieve session for auth header:', err);
  }
  return headers;
}
