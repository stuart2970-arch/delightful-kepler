'use client';

import { getSupabaseBrowserClient } from '../supabase-browser';
import { publicAppPath } from '../env/public-app-url';
import { isStylefloEmbed, isFramed } from '../env/embed-context';
import { openNamedPopup } from '../navigation/external-url';

const POPUP_FEATURES = 'popup,width=520,height=680';

export async function startGoogleOAuthPopup(options?: {
  redirectPath?: string;
  extraQuery?: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseBrowserClient();
  const redirectTo = publicAppPath(
    options?.redirectPath || '/auth/popup-complete',
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(options?.extraQuery ? { queryParams: options.extraQuery } : {}),
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Failed to start Google sign-in.' };
  }
  if (!data?.url) {
    return { ok: false, error: 'Failed to start Google sign-in.' };
  }

  const popup = openNamedPopup(data.url, 'sf_google_oauth', POPUP_FEATURES);
  if (!popup) {
    return { ok: false, error: 'Pop-up blocked. Allow pop-ups for this site and try again.' };
  }
  return { ok: true };
}

export function shouldUseGoogleOAuthPopup(): boolean {
  return isStylefloEmbed() || isFramed();
}