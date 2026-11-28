import { normalizeBrowserOrigin } from '../lib/turnstile-parent-origin';
import { resolveTurnstileSiteKey } from './turnstile-config';

export const TURNSTILE_TOKEN_TIMEOUT_MS = 30000;
/** Show Turnstile overlay only after this delay if still no token, error, or interactive hint. */
export const TURNSTILE_OVERLAY_FALLBACK_MS = 9000;
/** Refresh cached tokens before Cloudflare's ~300s expiry (single-use per public-init). */
export const TURNSTILE_TOKEN_MAX_AGE_MS = 270_000;

export class TurnstileTokenError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    const short = sanitizeTurnstileCode(code);
    super(message || userTurnstileMessage(short));
    this.code = short;
    this.name = 'TurnstileTokenError';
  }
}

export function sanitizeTurnstileCode(code: unknown): string {
  const raw = String(code ?? 'unknown').trim();
  if (!raw) return 'unknown';
  return raw.slice(0, 48);
}

export function userTurnstileMessage(code: string): string {
  return `Couldn't verify — tap to retry (${code})`;
}

export function isTransientTurnstileCode(code: string): boolean {
  const c = sanitizeTurnstileCode(code);
  if (c === '110600') return true;
  if (/^600/.test(c)) return true;
  if (/^300/.test(c)) return true;
  return false;
}

export type TurnstileUiState =
  | 'idle'
  | 'loading'
  | 'interactive'
  | 'retry'
  | 'ready';

export type TurnstileBridgeDeps = {
  appOrigin: string;
  parentPageOrigin: string;
  bakedTurnstileSiteKey: string;
  getMount: () => HTMLElement;
  onUiState?: (state: TurnstileUiState) => void;
};

type Waiter = {
  resolve: (token: string) => void;
  reject: (err: TurnstileTokenError) => void;
};

/**
 * Single app-origin Turnstile iframe for the widget shadow DOM. Prewarms on open,
 * reuses the same frame for gate + chat (no per-message respawn).
 */
export class TurnstileBridge {
  private readonly deps: TurnstileBridgeDeps;
  private overlay: HTMLDivElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private boundMessageHandler: ((event: MessageEvent) => void) | null = null;
  private waitTimeout: ReturnType<typeof setTimeout> | null = null;
  private overlayFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<string> | null = null;
  private activeWaiter: Waiter | null = null;
  private cachedToken: string | null = null;
  private tokenIssuedAt = 0;
  private tokenConsumed = true;
  private siteKeyPromise: Promise<string> | null = null;
  private overlayForcedVisible = false;
  private silentWait = false;
  private mountPromise: Promise<void> | null = null;
  private pendingError: TurnstileTokenError | null = null;
  private pendingToken: string | null = null;
  private widgetRunActive = false;

  constructor(deps: TurnstileBridgeDeps) {
    this.deps = deps;
  }

  prewarm(): void {
    void this.ensureMounted()
      .then(() => {
        if (!this.hasFreshToken() && !this.pendingToken) {
          // Prime the challenge without waiting — tokens are collected on gate/chat acquire.
          this.resetWidget({ clearCache: true });
        }
      })
      .catch((err) => {
        console.warn('[StyleFlo Widget] Turnstile prewarm:', err);
      });
  }

  hasFreshToken(): boolean {
    if (!this.cachedToken || this.tokenConsumed) return false;
    return Date.now() - this.tokenIssuedAt < TURNSTILE_TOKEN_MAX_AGE_MS;
  }

  markConsumed(): void {
    this.tokenConsumed = true;
    this.cachedToken = null;
    this.tokenIssuedAt = 0;
    this.pendingToken = null;
  }

  async acquireToken(options: { visible?: 'auto' | 'always'; retryOnce?: boolean } = {}): Promise<string> {
    if (this.hasFreshToken() && this.cachedToken) {
      return this.cachedToken;
    }

    const run = async (attempt: number): Promise<string> => {
      try {
        return await this.refreshToken({
          visible: options.visible ?? 'auto',
          reason: attempt > 0 ? 'retry' : 'acquire',
        });
      } catch (err) {
        if (options.retryOnce !== false && attempt === 0) {
          this.resetWidget({ clearCache: true });
          return run(1);
        }
        throw err;
      }
    };

    return run(0);
  }

  retryFromUser(): void {
    this.resetWidget({ clearCache: true });
    void this.refreshToken({ visible: 'auto', reason: 'user-retry' }).catch((err) => {
      console.error('[StyleFlo Widget] Turnstile user retry failed:', err);
    });
  }

  tearDown(): void {
    this.clearOverlayFallbackTimer();
    this.clearWaiter(new TurnstileTokenError('teardown'));
    if (this.boundMessageHandler) {
      window.removeEventListener('message', this.boundMessageHandler);
      this.boundMessageHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.iframe = null;
    this.inflight = null;
    this.widgetRunActive = false;
  }

  private setUiState(state: TurnstileUiState): void {
    this.deps.onUiState?.(state);
  }

  private reportFailure(code: string): void {
    const short = sanitizeTurnstileCode(code);
    console.error('[StyleFlo Widget] Turnstile error:', short);
  }

  private getHintEl(): HTMLElement | null {
    return this.overlay?.querySelector('#styleflo-turnstile-hint') as HTMLElement | null;
  }

  private getRetryBtn(): HTMLButtonElement | null {
    return this.overlay?.querySelector('#styleflo-turnstile-retry-btn') as HTMLButtonElement | null;
  }

  private revealOverlay(): void {
    if (!this.overlay) return;
    this.overlay.style.opacity = '1';
    this.overlay.style.pointerEvents = 'auto';
  }

  private hideOverlayUnlessForced(): void {
    if (!this.overlay || this.overlayForcedVisible) return;
    this.overlay.style.opacity = '0';
    this.overlay.style.pointerEvents = 'none';
  }

  private clearOverlayFallbackTimer(): void {
    if (this.overlayFallbackTimer !== null) {
      clearTimeout(this.overlayFallbackTimer);
      this.overlayFallbackTimer = null;
    }
  }

  private scheduleOverlayFallback(): void {
    this.clearOverlayFallbackTimer();
    this.overlayFallbackTimer = setTimeout(() => {
      this.overlayFallbackTimer = null;
      if (this.hasFreshToken() || this.pendingToken) return;
      if (this.overlayForcedVisible) return;
      const hint = this.getHintEl();
      if (hint) hint.style.display = 'block';
      this.overlayForcedVisible = true;
      this.revealOverlay();
      if (this.activeWaiter) {
        this.setUiState('interactive');
      }
    }, TURNSTILE_OVERLAY_FALLBACK_MS);
  }

  private isMobileViewport(): boolean {
    try {
      return window.matchMedia('(max-width: 639px)').matches;
    } catch {
      return false;
    }
  }

  private async resolveSiteKey(): Promise<string> {
    if (!this.siteKeyPromise) {
      this.siteKeyPromise = resolveTurnstileSiteKey(
        this.deps.appOrigin,
        this.deps.bakedTurnstileSiteKey,
      );
    }
    return this.siteKeyPromise;
  }

  private ensureMessageHandler(): void {
    if (this.boundMessageHandler) return;
    this.boundMessageHandler = (event: MessageEvent) => {
      const iframe = this.iframe;
      if (!iframe) return;
      if (event.origin !== this.deps.appOrigin) return;
      if (event.source !== iframe.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;

      const hint = this.getHintEl();
      const retryBtn = this.getRetryBtn();

      if (event.data.type === 'STYLEFLO_TURNSTILE_INTERACTIVE') {
        this.clearOverlayFallbackTimer();
        this.overlayForcedVisible = true;
        if (hint) hint.style.display = 'block';
        this.revealOverlay();
        this.setUiState('interactive');
        return;
      }

      if (event.data.type === 'STYLEFLO_TURNSTILE_EXPIRED') {
        this.markConsumed();
        this.widgetRunActive = false;
        this.resetWidget({ clearCache: true });
        return;
      }

      if (event.data.type === 'STYLEFLO_TURNSTILE_TOKEN' && event.data.token) {
        const token = String(event.data.token);
        this.clearOverlayFallbackTimer();
        this.widgetRunActive = false;
        this.pendingError = null;
        if (!this.activeWaiter) {
          this.pendingToken = token;
          this.cachedToken = token;
          this.tokenIssuedAt = Date.now();
          this.tokenConsumed = false;
          return;
        }
        this.cachedToken = token;
        this.tokenIssuedAt = Date.now();
        this.tokenConsumed = false;
        this.overlayForcedVisible = false;
        if (retryBtn) retryBtn.style.display = 'none';
        if (hint) hint.style.display = 'none';
        this.hideOverlayUnlessForced();
        this.setUiState('ready');
        this.finishWaiter(token);
        return;
      }

      if (event.data.type === 'STYLEFLO_TURNSTILE_ERROR') {
        const code = sanitizeTurnstileCode(event.data.code || event.data.error);
        this.reportFailure(code);
        const err = new TurnstileTokenError(code);
        if (!this.activeWaiter) {
          this.widgetRunActive = false;
          if (!this.pendingToken) {
            this.pendingError = err;
          }
          return;
        }
        if (this.pendingToken) {
          return;
        }
        if (isTransientTurnstileCode(code)) {
          return;
        }
        if (!this.silentWait) {
          this.clearOverlayFallbackTimer();
          if (hint) hint.style.display = 'block';
          if (retryBtn) {
            retryBtn.textContent = userTurnstileMessage(code);
            retryBtn.style.display = 'block';
          }
          this.overlayForcedVisible = true;
          this.revealOverlay();
          this.setUiState('retry');
        }
        this.widgetRunActive = false;
        this.clearWaiter(err);
      }
    };
    window.addEventListener('message', this.boundMessageHandler);
  }

  private async ensureMounted(): Promise<void> {
    if (this.iframe && this.overlay?.isConnected) return;
    if (this.mountPromise) return this.mountPromise;

    this.mountPromise = this.mountTurnstile().finally(() => {
      this.mountPromise = null;
    });
    return this.mountPromise;
  }

  private async mountTurnstile(): Promise<void> {
    const mount = this.deps.getMount();
    mount.querySelector('#styleflo-turnstile-overlay')?.remove();

    const turnstileSiteKey = await this.resolveSiteKey();
    const mobile = this.isMobileViewport();

    const overlay = document.createElement('div');
    overlay.id = 'styleflo-turnstile-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.gap = '12px';
    overlay.style.padding = mobile ? '16px' : '8px';
    overlay.style.background = 'rgba(17, 24, 39, 0.55)';
    overlay.style.zIndex = '40';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';

    const hint = document.createElement('p');
    hint.id = 'styleflo-turnstile-hint';
    hint.style.margin = '0';
    hint.style.fontSize = mobile ? '14px' : '12px';
    hint.style.fontWeight = '600';
    hint.style.color = '#f9fafb';
    hint.style.textAlign = 'center';
    hint.style.display = 'none';
    hint.textContent = 'Complete the security check below';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.id = 'styleflo-turnstile-retry-btn';
    retryBtn.style.display = 'none';
    retryBtn.style.padding = '10px 16px';
    retryBtn.style.borderRadius = '10px';
    retryBtn.style.border = 'none';
    retryBtn.style.background = '#ffffff';
    retryBtn.style.color = '#111827';
    retryBtn.style.fontWeight = '700';
    retryBtn.style.fontSize = '13px';
    retryBtn.style.cursor = 'pointer';
    retryBtn.textContent = "Couldn't verify — tap to retry";
    retryBtn.addEventListener('click', () => {
      retryBtn.style.display = 'none';
      if (hint) hint.style.display = 'block';
      this.retryFromUser();
    });

    const iframe = document.createElement('iframe');
    iframe.id = 'styleflo-turnstile-frame';
    iframe.title = 'Security verification';
    const parentOrigin =
      normalizeBrowserOrigin(this.deps.parentPageOrigin) || this.deps.parentPageOrigin;
    const params = new URLSearchParams({
      sitekey: turnstileSiteKey,
      parent_origin: parentOrigin,
    });
    iframe.src = `${this.deps.appOrigin}/turnstile.html?${params.toString()}`;
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
    );
    iframe.style.border = '0';
    iframe.style.borderRadius = '10px';
    iframe.style.background = '#ffffff';
    iframe.style.maxWidth = '100%';
    if (mobile) {
      iframe.style.width = 'min(100%, 320px)';
      iframe.style.height = '120px';
      iframe.style.minHeight = '120px';
    } else {
      iframe.style.width = '300px';
      iframe.style.height = '70px';
      iframe.style.minHeight = '70px';
    }

    overlay.appendChild(hint);
    overlay.appendChild(iframe);
    overlay.appendChild(retryBtn);
    mount.appendChild(overlay);

    this.overlay = overlay;
    this.iframe = iframe;
    this.overlayForcedVisible = false;
    this.ensureMessageHandler();
  }

  private postResetToIframe(): void {
    if (this.iframe?.contentWindow) {
      try {
        this.iframe.contentWindow.postMessage({ type: 'STYLEFLO_RESET_TURNSTILE' }, this.deps.appOrigin);
      } catch {
        // ignore
      }
    }
    this.widgetRunActive = true;
  }

  private resetWidget(options: { clearCache?: boolean } = {}): void {
    if (this.inflight) return;
    if (this.pendingToken && !this.tokenConsumed) return;
    if (options.clearCache !== false) {
      this.markConsumed();
    }
    this.pendingError = null;
    this.postResetToIframe();
  }

  private finishWaiter(token: string): void {
    if (this.waitTimeout !== null) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this.clearOverlayFallbackTimer();
    this.silentWait = false;
    const waiter = this.activeWaiter;
    this.activeWaiter = null;
    this.inflight = null;
    waiter?.resolve(token);
  }

  private clearWaiter(err: TurnstileTokenError): void {
    if (this.waitTimeout !== null) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this.clearOverlayFallbackTimer();
    this.silentWait = false;
    const waiter = this.activeWaiter;
    this.activeWaiter = null;
    this.inflight = null;
    waiter?.reject(err);
  }

  private async refreshToken(opts: {
    visible: 'auto' | 'always';
    reason: string;
    silent?: boolean;
  }): Promise<string> {
    if (this.inflight) {
      if (opts.visible === 'always' && this.silentWait) {
        this.clearWaiter(new TurnstileTokenError('superseded', 'Security check restarted.'));
      } else {
        return this.inflight;
      }
    }

    if (this.pendingToken && !this.tokenConsumed) {
      const token = this.pendingToken;
      this.pendingToken = null;
      this.cachedToken = token;
      this.tokenIssuedAt = Date.now();
      this.tokenConsumed = false;
      return token;
    }

    if (this.hasFreshToken() && this.cachedToken) {
      return this.cachedToken;
    }

    if (this.pendingError && !this.pendingToken && !this.widgetRunActive) {
      const err = this.pendingError;
      this.pendingError = null;
      throw err;
    }

    this.inflight = new Promise<string>((resolve, reject) => {
      void this.ensureMounted()
        .then(() => {
          this.silentWait = Boolean(opts.silent);
          this.overlayForcedVisible = false;
          this.setUiState('loading');

          const hint = this.getHintEl();
          const retryBtn = this.getRetryBtn();
          if (hint) hint.style.display = 'none';
          if (retryBtn) retryBtn.style.display = 'none';
          this.hideOverlayUnlessForced();
          this.scheduleOverlayFallback();

          if (this.pendingToken && !this.tokenConsumed) {
            const token = this.pendingToken;
            this.pendingToken = null;
            this.cachedToken = token;
            this.tokenIssuedAt = Date.now();
            this.tokenConsumed = false;
            this.finishWaiter(token);
            return;
          }

          if (this.pendingError && !this.pendingToken && !this.widgetRunActive) {
            const err = this.pendingError;
            this.pendingError = null;
            if (!this.silentWait) {
              const btn = this.getRetryBtn();
              if (hint) hint.style.display = 'block';
              if (btn) {
                btn.textContent = userTurnstileMessage(err.code);
                btn.style.display = 'block';
              }
              this.overlayForcedVisible = true;
              this.revealOverlay();
              this.setUiState('retry');
            }
            this.inflight = null;
            reject(err);
            return;
          }

          this.activeWaiter = {
            resolve,
            reject,
          };

          this.waitTimeout = setTimeout(() => {
            this.reportFailure('timeout');
            if (!this.silentWait) {
              const btn = this.getRetryBtn();
              if (hint) hint.style.display = 'block';
              if (btn) {
                btn.textContent = userTurnstileMessage('timeout');
                btn.style.display = 'block';
              }
              this.overlayForcedVisible = true;
              this.revealOverlay();
              this.setUiState('retry');
            } else {
              this.hideOverlayUnlessForced();
              this.setUiState('idle');
            }
            this.silentWait = false;
            this.widgetRunActive = false;
            this.clearWaiter(new TurnstileTokenError('timeout', 'Turnstile verification timed out.'));
          }, TURNSTILE_TOKEN_TIMEOUT_MS);

          if (opts.reason !== 'prewarm' && !this.pendingToken) {
            if (this.widgetRunActive) {
              this.postResetToIframe();
            } else {
              this.resetWidget({ clearCache: false });
            }
          }
        })
        .catch(() => {
          this.clearWaiter(new TurnstileTokenError('mount_failed'));
        });
    });

    return this.inflight;
  }
}