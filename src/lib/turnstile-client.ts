const DUMMY_SITE_KEY_PREFIXES = ['1x', '2x', '3x'];

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  appearance?: 'always' | 'execute' | 'interaction-only';
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset?: (widgetId: string) => void;
};

type TurnstileWindow = Window & {
  turnstile?: TurnstileApi;
  __STYLEFLO_TEST_TURNSTILE_TOKEN__?: string;
  __STYLEFLO_TEST_TURNSTILE_SITE_KEY__?: string;
};

function turnstileWindow(): TurnstileWindow | undefined {
  if (typeof window === 'undefined') return undefined;
  return window as TurnstileWindow;
}

/** Literal NEXT_PUBLIC_ access so Next inlines the value at `next build`. */
export function getTurnstileSiteKey(): string {
  const testKey = turnstileWindow()?.__STYLEFLO_TEST_TURNSTILE_SITE_KEY__;
  if (testKey) return testKey;
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

type MountedWidget = {
  container: HTMLElement;
  widgetId: string;
  siteKey: string;
};

let tokenSlot: TokenSlot | null = null;
let mountedWidget: MountedWidget | null = null;
let mountInFlight = false;

function createTokenSlot(): TokenSlot {
  let resolve!: (token: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, settled: false };
}

function ensureSlot(): TokenSlot {
  if (!tokenSlot) tokenSlot = createTokenSlot();
  return tokenSlot;
}

function settle(slot: TokenSlot, error: Error | null, token?: string) {
  if (slot.settled) return;
  slot.settled = true;
  if (error) slot.reject(error);
  else slot.resolve(token || '');
}

function resetMountedWidget() {
  const widgetId = mountedWidget?.widgetId;
  const reset = turnstileWindow()?.turnstile?.reset;
  if (!widgetId || !reset) return;
  try {
    reset(widgetId);
  } catch {
    // The next getBrowserTurnstileToken call will wait on a new slot.
  }
}

/**
 * Drop a consumed or failed token so the next request cannot reuse it.
 * Turnstile tokens are single-use; reset the still-mounted widget for a fresh one.
 */
function releaseSlot(slot: TokenSlot | null) {
  if (slot && tokenSlot === slot) {
    tokenSlot = null;
  }
  resetMountedWidget();
}

function waitForToken(slot: TokenSlot, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      settle(slot, new Error('Security check timed out.'));
    }, timeoutMs);
    slot.promise.then(
      (token) => {
        window.clearTimeout(timeoutId);
        resolve(token);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function loadTurnstileScript(): Promise<void> {
  const win = turnstileWindow();
  if (!win) return Promise.resolve();
  if (win.turnstile) return Promise.resolve();
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

function renderInto(container: HTMLElement, siteKey: string) {
  loadTurnstileScript()
    .then(() => {
      const turnstile = turnstileWindow()?.turnstile;
      if (!turnstile) {
        mountInFlight = false;
        settle(ensureSlot(), new Error('Security check could not start.'));
        return;
      }
      container.dataset.turnstileRendered = 'live';
      mountedWidget = { container, widgetId: '', siteKey };
      const widgetId = String(
        turnstile.render(container, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (token: string) => settle(ensureSlot(), null, token),
          'error-callback': () => settle(ensureSlot(), new Error('Security check failed.')),
        }),
      );
      mountedWidget.widgetId = widgetId;
      mountInFlight = false;
    })
    .catch(() => {
      mountInFlight = false;
      settle(ensureSlot(), new Error('Security check could not start.'));
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
  if (mountedWidget || mountInFlight) return;
  mountInFlight = true;
  ensureSlot();
  renderInto(container, siteKey);
}

/**
 * Token for same-origin auth requests. Dummy site keys (local and staging
 * always-pass keys) are sent as the token. A real site key renders Turnstile.
 * Each returned token is consumed exactly once; the mounted widget is reset
 * so the next call receives a fresh token.
 */
export async function getBrowserTurnstileToken(): Promise<string> {
  const win = turnstileWindow();
  if (win?.__STYLEFLO_TEST_TURNSTILE_TOKEN__) {
    return win.__STYLEFLO_TEST_TURNSTILE_TOKEN__;
  }

  const siteKey = getTurnstileSiteKey();
  const dummy = dummyTokenForSiteKey(siteKey);
  if (dummy) return dummy;
  if (!siteKey) {
    throw new Error('Security check is not configured.');
  }

  if (!mountedWidget && !mountInFlight) {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.width = '0';
    container.style.height = '0';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
    mountTurnstileWidget(container);
  }

  const slot = ensureSlot();
  try {
    const token = await waitForToken(slot, 15000);
    releaseSlot(slot);
    return token;
  } catch (error) {
    releaseSlot(slot);
    throw error;
  }
}
