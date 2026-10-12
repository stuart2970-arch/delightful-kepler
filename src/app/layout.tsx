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

export const metadata: Metadata = {
  title: "StyleFlo AI Chatbot Platform",
  description: "AI-Powered Customer Support & Scheduling Widget",
};

import { Suspense } from "react";
import IframeResizer from "@/components/IframeResizer";
import Analytics from "@/components/Analytics";

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
        {/* 1. Google Consent Mode v2 (default denied, runs before any tag/script) */}
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

        {/* 2. CookieYes Banner Script */}
        <script
          id="cookieyes"
          type="text/javascript"
          src="https://cdn-cookieyes.com/client_data/d5b119468f48c13f083b0c3f59232ce3/script.js"
        />

        {/* 3. Cross-subdomain consent sharing across .styleflo.ai */}
        <script
          id="cookieyes-subdomain-sync"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function syncConsentCookie() {
                  if (typeof document === 'undefined') return;
                  var host = window.location.hostname;
                  if (!host.endsWith('styleflo.ai')) return;
                  var match = document.cookie.match(/(?:^|;\\s*)cookieyes-consent=([^;]+)/);
                  if (match && match[1]) {
                    document.cookie = 'cookieyes-consent=' + match[1] + '; domain=.styleflo.ai; path=/; max-age=31536000; SameSite=Lax; Secure';
                  }
                }
                document.addEventListener('cookieyes_consent_update', syncConsentCookie);
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', syncConsentCookie);
                } else {
                  syncConsentCookie();
                }
              })();
            `,
          }}
        />
      </head>
      <body className="flex flex-col bg-[var(--awb-color3)] text-[var(--awb-color7)] font-sans">
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <IframeResizer />
        {children}
      </body>
    </html>
  );
}
