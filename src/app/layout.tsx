import type { Metadata } from "next";
import { Poppins, Inter } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const isStaging =
  (process.env.APP_ENV || process.env.NEXT_PUBLIC_ENV || "")
    .trim()
    .toLowerCase() === "staging";

export const metadata: Metadata = {
  title: isStaging
    ? "[STAGING] StyleFlo AI Chatbot Platform"
    : "StyleFlo AI Chatbot Platform",
  description: "AI-Powered Customer Support & Scheduling Widget",
  ...(isStaging
    ? { robots: { index: false, follow: false, nocache: true } }
    : {}),
};

import { Suspense } from "react";
import IframeResizer from "@/components/IframeResizer";
import Analytics from "@/components/Analytics";
import StagingBanner from "@/components/StagingBanner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${inter.variable} antialiased`}
    >
      <head>
        {/* 1. Google Consent Mode v2 (default denied, runs before any tag/script both inside and outside frame) */}
        <script
          id="google-consent-mode-default"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('consent', 'default', {
                'analytics_storage': 'denied',
                'ad_storage': 'denied',
                'ad_user_data': 'denied',
                'ad_personalization': 'denied',
                'wait_for_update': 500
              });
              gtag('set', 'ads_data_redaction', true);
              gtag('set', 'url_passthrough', true);
            `,
          }}
        />

        {/* 2. CookieYes Banner Script: ONLY load when top-level (window.self === window.top) */}
        {/* Inside styleflo.ai/app/ frame, do NOT load CookieYes banner at all */}
        <script
          id="cookieyes-conditional-loader"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var isTopWindow = false;
                try {
                  isTopWindow = (window.self === window.top);
                } catch(e) {
                  isTopWindow = false;
                }

                if (isTopWindow) {
                  // Direct visit on app.styleflo.ai: load CookieYes banner
                  var script = document.createElement('script');
                  script.id = 'cookieyes';
                  script.type = 'text/javascript';
                  script.src = 'https://cdn-cookieyes.com/client_data/d5b119468f48c13f083b0c3f59232ce3/script.js';
                  document.head.appendChild(script);

                  // Sync consent cookie with domain=.styleflo.ai for seamless sharing
                  function syncConsentCookie() {
                    var host = window.location.hostname;
                    if (!host.endsWith('styleflo.ai')) return;
                    var match = document.cookie.match(/(?:^|;\\s*)cookieyes-consent=([^;]+)/);
                    if (match && match[1]) {
                      var hostOnly = host === 'staging.styleflo.ai' || host.indexOf('staging.') === 0;
                      var domainPart = hostOnly ? '' : '; domain=.styleflo.ai';
                      document.cookie = 'cookieyes-consent=' + match[1] + domainPart + '; path=/; max-age=31536000; SameSite=Lax; Secure';
                    }
                  }
                  document.addEventListener('cookieyes_consent_update', syncConsentCookie);
                  if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', syncConsentCookie);
                  } else {
                    syncConsentCookie();
                  }
                }
              })();
            `,
          }}
        />
      </head>
      <body className="flex flex-col bg-[var(--awb-color3)] text-[var(--awb-color7)] font-sans">
        <StagingBanner />
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <IframeResizer />
        {children}
      </body>
    </html>
  );
}
