import { getDashboardAuthHeaders } from '@/lib/auth/dashboard-auth-headers';

/** Bearer token for dashboard fetches. Uses a fresh access token. */
export function browserAuthHeaders(
  baseHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  return getDashboardAuthHeaders(baseHeaders);
}
