const DUMMY_SITE_KEY_PREFIXES = ['1x', '2x', '3x'];

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      appearance?: 'always' | 'execute' | 'interaction-only';
    },
  ) => string;
};

function dummyTokenForSiteKey(siteKey: string): string | null {
  if (DUMMY_SITE_KEY_PREFIXES.some((prefix) => siteKey.startsWith(prefix))) {
    return siteKey;
  }
  return null;
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as Window & { turnstile?: TurnstileApi }).turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-styleflo-turnstile="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.stylefloTurnstile = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load.'));
    document.head.appendChild(script);
  });
}

/**
 * Token for same-origin auth requests. Dummy site keys (local and staging
 * always-pass keys) are sent as the token. A real site key renders Turnstile.
 */
export async function getBrowserTurnstileToken(): Promise<string> {
  if (typeof window !== 'undefined') {
    const testToken = (window as Window & { __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string })
      .__STYLEFLO_TEST_TURNSTILE_TOKEN__;
    if (testToken) return testToken;
  }

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const dummy = dummyTokenForSiteKey(siteKey);
  if (dummy) return dummy;
  if (!siteKey) {
    throw new Error('Security check is not configured.');
  }

  await loadTurnstileScript();
  const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
  if (!turnstile) throw new Error('Security check could not start.');

  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.width = '0';
    container.style.height = '0';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
    const timeout = window.setTimeout(() => {
      container.remove();
      reject(new Error('Security check timed out.'));
    }, 15000);
    turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: (token: string) => {
        window.clearTimeout(timeout);
        container.remove();
        resolve(token);
      },
      'error-callback': () => {
        window.clearTimeout(timeout);
        container.remove();
        reject(new Error('Security check failed.'));
      },
    });
  });
}
