'use client';

import { openNamedPopup } from '../navigation/external-url';

const POPUP_FEATURES = 'popup,width=520,height=680';

/** Opens calendar OAuth in a popup; completion is handled by EmbedBootstrap (STYLEFLO_OAUTH_DONE). */
export function openCalendarOAuthPopup(provider: 'google' | 'microsoft', staffId?: string): boolean {
  if (typeof window === 'undefined') return false;
  const path =
    provider === 'google'
      ? '/api/integrations/google/authorize'
      : '/api/integrations/microsoft/authorize';
  const url = new URL(path, window.location.origin);
  url.searchParams.set('popup', '1');
  if (staffId) url.searchParams.set('staffId', staffId);

  const popup = openNamedPopup(url.toString(), 'sf_oauth', POPUP_FEATURES);
  return Boolean(popup);
}