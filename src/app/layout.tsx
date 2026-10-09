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
