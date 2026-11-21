/**
 * Turnstile site keys are public. Deploy builds may bake NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * into widget.js; committed bundles use an empty bake and load the key from the app
 * origin at runtime so production/staging never depend on git-tracked bundles.
 */
export async function resolveTurnstileSiteKey(
  appOrigin: string,
  bakedFromBuild: string,
): Promise<string> {
  const baked = (bakedFromBuild || '').trim();
  if (baked) return baked;

  const res = await fetch(`${appOrigin}/api/config/public`, {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Turnstile config HTTP ${res.status}`);
  }
  const body = (await res.json()) as { turnstileSiteKey?: string };
  const key = (body.turnstileSiteKey || '').trim();
  if (!key) {
    throw new Error('Turnstile site key missing');
  }
  return key;
}