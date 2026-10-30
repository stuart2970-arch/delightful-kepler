/**
 * STYL-226: SSO cookie Domain attribute.
 * Staging uses host-only cookies (no Domain) so they never leak to production.
 */

export type CookieDomainInput = {
  appEnv?: string;
  nodeEnv?: string;
  hostname?: string;
};

export function resolveSsoCookieDomain(input: CookieDomainInput = {}): string | undefined {
  const appEnv = (input.appEnv || '').trim().toLowerCase();
  const nodeEnv = (input.nodeEnv || '').trim().toLowerCase();
  const hostname = (input.hostname || '').split(':')[0].toLowerCase();

  if (appEnv === 'staging' || hostname === 'staging.styleflo.ai') {
    return undefined;
  }

  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isDev =
    nodeEnv === 'development' ||
    nodeEnv === 'test' ||
    appEnv === 'development' ||
    appEnv === 'test';

  if (isLocalHost || isDev) {
    return '.styleflo.test';
  }

  return '.styleflo.ai';
}
