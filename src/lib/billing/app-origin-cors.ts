import { resolveServerPublicAppOrigin } from '@/lib/env/public-app-url';

export function allowedBillingAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const fromAppUrl = (env.APP_URL || '').trim();
  if (fromAppUrl) {
    try {
      return new URL(fromAppUrl).origin;
    } catch {
      // Fall through to NEXT_PUBLIC_APP_URL / SITE_URL.
    }
  }
  return resolveServerPublicAppOrigin(env);
}

export function billingCorsHeaders(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  const origin = (req.headers.get('origin') || '').trim();
  if (origin && origin === allowedBillingAppOrigin(env)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
