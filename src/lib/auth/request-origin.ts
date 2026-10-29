/**
 * Browser requests must come from this app. A missing Origin header is allowed
 * so non-browser clients can call the route, and Turnstile still applies.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host && originUrl.host === host) return true;

  const configured = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL];
  for (const value of configured) {
    if (!value) continue;
    try {
      if (new URL(value).origin === originUrl.origin) return true;
    } catch {
      // Ignore a malformed configured URL.
    }
  }

  return false;
}
