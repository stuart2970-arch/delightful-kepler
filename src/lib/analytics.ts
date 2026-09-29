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
 * Track successful Sign Up conversion across GTM, GA4, Meta & TikTok Pixels
 */
export const trackSignUp = (method: string = 'email', plan: string = 'starter') => {
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

  // Meta (Facebook) Pixel
  if (window.fbq) {
    window.fbq('track', 'CompleteRegistration', {
      content_name: plan,
      status: true,
      registration_method: method,
      value,
      currency: 'GBP',
    });
  }

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
