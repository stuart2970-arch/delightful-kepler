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

/** Literal NEXT_PUBLIC_ access so Next inlines the value at `next build`. */
export function getTurnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
}

export function isDummyTurnstileSiteKey(siteKey: string): boolean {
  return DUMMY_SITE_KEY_PREFIXES.some((prefix) => siteKey.startsWith(prefix));
}

function dummyTokenForSiteKey(siteKey: string): string | null {
  if (isDummyTurnstileSiteKey(siteKey)) return siteKey;
  return null;
}

type TokenSlot = {
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  settled: boolean;
};

let tokenSlot: TokenSlot | null = null;

function createTokenSlot(): TokenSlot {
  let resolve!: (token: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, settled: false };
}

function settle(slot: TokenSlot, error: Error | null, token?: string) {
  if (slot.settled) return;
  slot.settled = true;
  if (error) slot.reject(error);
  else slot.resolve(token || '');
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

function renderInto(container: HTMLElement, siteKey: string, slot: TokenSlot) {
  loadTurnstileScript()
    .then(() => {
      const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (!turnstile) {
        settle(slot, new Error('Security check could not start.'));
        return;
      }
      container.dataset.turnstileRendered = 'live';
      turnstile.render(container, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (token: string) => settle(slot, null, token),
        'error-callback': () => settle(slot, new Error('Security check failed.')),
      });
    })
    .catch(() => {
      settle(slot, new Error('Security check could not start.'));
    });
}

/**
 * Mount the Turnstile widget into a visible host when a real site key is set.
 * Dummy always-pass keys (local and staging) skip the remote script; the host
 * element is still the widget the login page shows.
 */
export function mountTurnstileWidget(container: HTMLElement): void {
  const siteKey = getTurnstileSiteKey();
  if (!siteKey || isDummyTurnstileSiteKey(siteKey)) return;
  if (tokenSlot) return;
  const slot = createTokenSlot();
  tokenSlot = slot;
  renderInto(container, siteKey, slot);
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

  const siteKey = getTurnstileSiteKey();
  const dummy = dummyTokenForSiteKey(siteKey);
  if (dummy) return dummy;
  if (!siteKey) {
    throw new Error('Security check is not configured.');
  }

  if (!tokenSlot) {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.width = '0';
    container.style.height = '0';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
    mountTurnstileWidget(container);
  }
  if (!tokenSlot) throw new Error('Security check is not configured.');

  const timeout = new Promise<string>((_, reject) => {
    window.setTimeout(() => reject(new Error('Security check timed out.')), 15000);
  });
  return Promise.race([tokenSlot.promise, timeout]);
}
