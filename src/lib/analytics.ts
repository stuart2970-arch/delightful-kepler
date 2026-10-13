declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    ttq?: {
      track: (event: string, data?: Record<string, any>) => void;
      page: () => void;
    };
    dataLayer?: any[];
  }
}

export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
export const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
export const TIKTOK_PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;

/**
 * Helper to push standard events to GTM dataLayer
 */
export const pushToDataLayer = (event: string, data: Record<string, any> = {}) => {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event,
    ...data,
  });
};

/**
 * Track Page View on route changes
 */
export const trackPageView = (url: string) => {
  if (typeof window === 'undefined') return;

  // GTM Page View
  pushToDataLayer('page_view', { page_path: url });

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag('config', GA_MEASUREMENT_ID, {
      page_path: url,
    });
  }

  if (FB_PIXEL_ID && window.fbq) {
    window.fbq('track', 'PageView');
  }

  if (TIKTOK_PIXEL_ID && window.ttq) {
    window.ttq.page();
  }
};

/**
 * Check if the visitor accepted CookieYes advertising cookies (ad_storage granted)
 */
export const hasAdvertisingConsent = (): boolean => {
  if (typeof window === 'undefined') return false;

  // 1. Check CookieYes official API
  try {
    if (typeof (window as any).getCkyConsent === 'function') {
      const consent = (window as any).getCkyConsent();
      if (consent && consent.categories && consent.categories.advertisement !== undefined) {
        return Boolean(consent.categories.advertisement);
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Check CookieYes consent cookie (cookieyes-consent)
  try {
    const match = document.cookie.match(/(?:^|;\s*)cookieyes-consent=([^;]+)/);
    if (match) {
      const val = decodeURIComponent(match[1]);
      if (val.includes('advertisement:yes') || val.includes('"advertisement":true') || val.includes('"advertisement":"yes"')) {
        return true;
      }
      if (val.includes('advertisement:no') || val.includes('"advertisement":false') || val.includes('"advertisement":"no"')) {
        return false;
      }
    }
  } catch (e) {
    // ignore
  }

  // 3. Check Google Consent Mode v2 ad_storage status if updated by CookieYes
  try {
    const ics = (window as any).google_tag_data?.ics?.entries;
    if (ics?.ad_storage) {
      const status = ics.ad_storage;
      if (status === 'granted' || status?.default === 'granted' || status?.update === 'granted' || status === 1) {
        return true;
      }
    }
  } catch (e) {
    // ignore
  }

  return false;
};

/**
 * Ensure Meta Pixel fbq script is loaded in the browser
 */
export const ensureFbqLoaded = () => {
  if (typeof window === 'undefined') return;
  if (window.fbq) return;

  (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
};

/**
 * Helper to dispatch analytics conversion messages to the parent frame (https://styleflo.ai)
 * dispatched whatever the app's consent state, as the parent site checks consent before sending to Meta.
 */
export const postEventToParent = (payload: Record<string, any>) => {
  if (typeof window === 'undefined') return;
  try {
    const isFrame = (window.self !== window.top);
    if (isFrame && window.parent) {
      // Post to parent container. We support both production https://styleflo.ai and local testing
      window.parent.postMessage(payload, '*');
      console.log('[Analytics] Dispatched postMessage to parent window:', payload);
    }
  } catch (e) {
    console.error('[Analytics] Failed to send postMessage to parent:', e);
  }
};

/**
 * Track Meta Pixel CompleteRegistration if CookieYes advertising consent is granted.
 * Inside iframe (styleflo.ai/app/), sends postMessage to parent frame regardless of consent state.
 */
export const trackCompleteRegistrationMeta = (userId?: string) => {
  if (typeof window === 'undefined') return;

  const eventPayload = {
    type: 'STYLEFLO_REGISTRATION',
    event: 'CompleteRegistration',
    value: 9.99,
    currency: 'GBP',
    eventID: 'reg_' + (userId || ''),
  };

  // 1. If running inside iframe, always notify parent frame (styleflo.ai checks consent)
  postEventToParent(eventPayload);

  // 2. If opened directly at top-level (app.styleflo.ai), check local CookieYes advertising consent
  const isTopWindow = (window.self === window.top);
  if (isTopWindow) {
    if (!hasAdvertisingConsent()) {
      console.log('[Analytics] Direct CompleteRegistration Meta event skipped (no CookieYes ad_storage consent)');
      return;
    }

    ensureFbqLoaded();
    if (window.fbq) {
      window.fbq('init', '1072502378701795');
      window.fbq('track', 'CompleteRegistration', {
        value: 9.99,
        currency: 'GBP',
      }, {
        eventID: 'reg_' + (userId || ''),
      });
      console.log(`[Analytics] Direct CompleteRegistration Meta event fired (eventID: reg_${userId || ''})`);
    }
  }
};

/**
 * Track Meta Pixel Purchase event on payment-confirmed page.
 * Inside iframe (styleflo.ai/app/), sends postMessage to parent frame regardless of consent state.
 */
export const trackPurchaseMeta = (amountPaid: number, orderOrSubscriptionId: string) => {
  if (typeof window === 'undefined') return;

  const eventPayload = {
    type: 'STYLEFLO_PURCHASE',
    event: 'Purchase',
    value: Number(amountPaid) || 9.99,
    currency: 'GBP',
    eventID: 'pur_' + orderOrSubscriptionId,
  };

  // 1. If running inside iframe, always notify parent frame (styleflo.ai checks consent)
  postEventToParent(eventPayload);

  // 2. If opened directly at top-level (app.styleflo.ai), check local CookieYes advertising consent
  const isTopWindow = (window.self === window.top);
  if (isTopWindow) {
    if (!hasAdvertisingConsent()) {
      console.log('[Analytics] Direct Purchase Meta event skipped (no CookieYes ad_storage consent)');
      return;
    }

    ensureFbqLoaded();
    if (window.fbq) {
      window.fbq('init', '1072502378701795');
      window.fbq('track', 'Purchase', {
        value: Number(amountPaid) || 9.99,
        currency: 'GBP',
      }, {
        eventID: 'pur_' + orderOrSubscriptionId,
      });
      console.log(`[Analytics] Direct Purchase Meta event fired (value: ${amountPaid}, eventID: pur_${orderOrSubscriptionId})`);
    }
  }
};

/**
 * Track successful Sign Up conversion across GTM, GA4, Meta & TikTok Pixels
 */
export const trackSignUp = (method: string = 'email', plan: string = 'starter', userId?: string) => {
  if (typeof window === 'undefined') return;

  const value = plan === 'premium' ? 79 : plan === 'basic' ? 5.99 : 29;

  // GTM Event
  pushToDataLayer('sign_up', {
    method,
    plan,
    value,
    currency: 'GBP',
  });

  // Google Analytics (GA4)
  if (window.gtag) {
    window.gtag('event', 'sign_up', {
      method,
      plan,
    });
    window.gtag('event', 'generate_lead', {
      currency: 'GBP',
      value,
    });
  }

  // Meta (Facebook) Pixel with CookieYes consent check
  trackCompleteRegistrationMeta(userId);

  // TikTok Pixel
  if (window.ttq) {
    window.ttq.track('CompleteRegistration', {
      content_name: plan,
      value,
      currency: 'GBP',
    });
  }
};

/**
 * Track visitors who have NOT yet signed up for custom remarketing audiences
 */
export const trackVisitorNotSignedUp = (pageName: string, extraData?: Record<string, any>) => {
  if (typeof window === 'undefined') return;

  pushToDataLayer('visitor_not_signed_up', { page_name: pageName, ...extraData });

  if (window.gtag) {
    window.gtag('event', 'visitor_not_signed_up', {
      page_name: pageName,
      ...extraData,
    });
  }

  if (window.fbq) {
    window.fbq('trackCustom', 'VisitorNotSignedUp', {
      page_name: pageName,
      ...extraData,
    });
  }
};

/**
 * Track Lead Intent / High Interest actions (e.g. clicking Register, submitting form)
 */
export const trackLeadIntent = (action: string, label?: string) => {
  if (typeof window === 'undefined') return;

  pushToDataLayer('lead_intent', { event_category: 'Engagement', event_action: action, event_label: label });

  if (window.gtag) {
    window.gtag('event', 'lead_intent', {
      event_category: 'Engagement',
      event_action: action,
      event_label: label,
    });
  }

  if (window.fbq) {
    window.fbq('track', 'Lead', {
      content_category: action,
      content_name: label || action,
    });
  }

  if (window.ttq) {
    window.ttq.track('SubmitForm', {
      content_name: label || action,
    });
  }
};
