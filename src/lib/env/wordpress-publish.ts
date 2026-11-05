/**
 * STYL-226: WordPress page publish stays off on staging and never
 * falls back to the live marketing site or a hard-coded token.
 */

export type WordpressPublishConfig =
  | { enabled: false; reason: string }
  | { enabled: true; wordpressSiteUrl: string; token: string };

export function getWordpressPublishConfig(
  env: NodeJS.ProcessEnv = process.env,
): WordpressPublishConfig {
  const appEnv = (env.APP_ENV || env.NEXT_PUBLIC_ENV || '').trim().toLowerCase();
  if (appEnv === 'staging') {
    return {
      enabled: false,
      reason: 'Publishing to WordPress is disabled on staging',
    };
  }

  const wordpressSiteUrl = (env.WORDPRESS_SITE_URL || '').trim().replace(/\/+$/, '');
  const token = (env.STYLEFLO_WP_CREATE_BUSINESS_TOKEN || '').trim();
  if (!wordpressSiteUrl || !token) {
    return {
      enabled: false,
      reason: 'WordPress publishing is not configured',
    };
  }

  return { enabled: true, wordpressSiteUrl, token };
}
