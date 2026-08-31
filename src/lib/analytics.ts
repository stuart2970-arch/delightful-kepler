declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
export const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;

/**
 * Track Page View on route changes
 */
export const trackPageView = (url: string) => {
  if (typeof window === 'undefined') return;

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag('config', GA_MEASUREMENT_ID, {
      page_path: url,
    });
  }

  if (FB_PIXEL_ID && window.fbq) {
    window.fbq('track', 'PageView');
  }
};

/**
 * Track successful Sign Up conversion across GA4 & Meta Pixel
 */
export const trackSignUp = (method: string = 'email', plan: string = 'starter') => {
  if (typeof window === 'undefined') return;

  if (window.gtag) {
    window.gtag('event', 'sign_up', {
      method,
      plan,
    });
    window.gtag('event', 'generate_lead', {
      currency: 'GBP',
      value: plan === 'premium' ? 79 : plan === 'basic' ? 5.99 : 29,
    });
  }

  if (window.fbq) {
    window.fbq('track', 'CompleteRegistration', {
      content_name: plan,
      status: true,
      registration_method: method,
    });
  }
};

/**
 * Track visitors who have NOT yet signed up for custom remarketing audiences
 */
export const trackVisitorNotSignedUp = (pageName: string, extraData?: Record<string, any>) => {
  if (typeof window === 'undefined') return;

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
};
