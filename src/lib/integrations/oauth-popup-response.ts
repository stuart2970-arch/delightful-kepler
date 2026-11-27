import { NextResponse } from 'next/server';
import { getPublicAppOrigin } from '@/lib/env/public-app-url';

const STYLEFLO_OAUTH_DONE = 'STYLEFLO_OAUTH_DONE';

export function oauthPopupCompleteHtml(provider: string, status: 'success' | 'error'): string {
  const targetOrigin = JSON.stringify(getPublicAppOrigin());
  const payload = JSON.stringify({ type: STYLEFLO_OAUTH_DONE, provider, status });
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Connected</title></head>
<body style="font-family:system-ui,sans-serif;padding:1.5rem;text-align:center;">
<p>${status === 'success' ? 'Calendar connected. You can close this window.' : 'Connection could not be completed.'}</p>
<script>
(function () {
  var origin = ${targetOrigin};
  var msg = ${payload};
  try {
    if (window.opener) window.opener.postMessage(msg, origin);
  } catch (e) {}
  setTimeout(function () { window.close(); }, 300);
})();
</script>
</body></html>`;
}

export function oauthPopupCompleteResponse(provider: string, status: 'success' | 'error' = 'success'): NextResponse {
  return new NextResponse(oauthPopupCompleteHtml(provider, status), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}