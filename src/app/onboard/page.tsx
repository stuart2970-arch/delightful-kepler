"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function OnboardContent() {
  const searchParams = useSearchParams();
  const resumeCode = searchParams.get('resume') || searchParams.get('code') || '';

  const [botLoaded, setBotLoaded] = useState(false);

  useEffect(() => {
    // Inject the widget script dynamically for full-screen FloBot onboarding
    const scriptId = 'styleflo-onboard-widget-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = '/embed.js';
      script.setAttribute('data-chatbot-id', 'styleflo-onboarding-flobot');
      script.setAttribute('data-mode', 'full-page');
      if (resumeCode) {
        script.setAttribute('data-resume-code', resumeCode);
      }
      script.onload = () => setBotLoaded(true);
      document.body.appendChild(script);
    } else {
      setBotLoaded(true);
    }
  }, [resumeCode]);

  return (
    <main className="min-h-screen flex flex-col bg-gray-950 text-white font-sans relative overflow-hidden">
      {/* Header Bar */}
      <header className="h-16 border-b border-gray-800/80 bg-gray-900/60 backdrop-blur-xl px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            ⚡
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
              StyleFlo Assistant Builder
              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30 font-mono font-bold">
                FloBot AI
              </span>
            </h1>
            <p className="text-[11px] text-gray-400">Conversational Onboarding Journey</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/register"
            className="text-xs font-semibold text-gray-300 hover:text-white transition-colors"
          >
            Direct Register
          </Link>
          <Link
            href="/login"
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20 transition-all"
          >
            Sign In ↗
          </Link>
        </div>
      </header>

      {/* Main Conversational Container */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 relative z-10">
        <div className="w-full max-w-2xl h-[80vh] bg-gray-900/70 border border-gray-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col relative backdrop-blur-xl">
          <div id="styleflo-widget-container" className="w-full h-full flex flex-col">
            {/* Fallback loader until embed script mounts */}
            {!botLoaded && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <div>
                  <h3 className="text-base font-bold text-white">Initializing FloBot...</h3>
                  <p className="text-xs text-gray-400 mt-1">Connecting to StyleFlo AI Assistant Builder</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function OnboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
        </div>
      }
    >
      <OnboardContent />
    </Suspense>
  );
}
