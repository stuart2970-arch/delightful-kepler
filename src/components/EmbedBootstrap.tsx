'use client';

import { useEffect } from 'react';
import {
  initEmbedFromQuery,
  installEmbedHelloListener,
  normalizedAppPathSearch,
  resolveSfPathRedirect,
  STYLEFLO_AUTH_DONE,
  STYLEFLO_OAUTH_DONE,
  isAllowedEmbedParentOrigin,
} from '@/lib/env/embed-context';

export default function EmbedBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    initEmbedFromQuery(params);

    const teardownHello = installEmbedHelloListener();

    const sfTarget = resolveSfPathRedirect(params);
    if (sfTarget) {
      const target = new URL(sfTarget, window.location.origin);
      const desired = normalizedAppPathSearch(target.pathname, target.search);
      const current = normalizedAppPathSearch(
        window.location.pathname,
        window.location.search,
      );
      if (desired !== current) {
        window.location.replace(desired);
      }
    }

    const onMessage = (event: MessageEvent) => {
      if (!event.data?.type) return;
      if (event.origin !== window.location.origin && !isAllowedEmbedParentOrigin(event.origin)) {
        return;
      }
      if (event.data.type === STYLEFLO_AUTH_DONE) {
        window.location.assign('/dashboard');
        return;
      }
      if (event.data.type === STYLEFLO_OAUTH_DONE) {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'scheduling');
        if (event.data.status === 'success') {
          url.searchParams.set('success', String(event.data.provider || 'calendar'));
        }
        window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      teardownHello();
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}