"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import LegalModal from '@/components/LegalModal';

function OnboardContent() {
  const searchParams = useSearchParams();
  const resumeCode = searchParams.get('resume') || searchParams.get('code') || '';
  const isEmbed = searchParams.get('embed') === 'true' || searchParams.get('hideHeader') === 'true';

  const [botLoaded, setBotLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalModal, setLegalModal] = useState<{ isOpen: boolean; title: string; url: string }>({
    isOpen: false,
    title: '',
    url: '',
  });

  const [supabase] = useState(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables are missing');
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  });

  const openLegalModal = (title: string, url: string) => {
    setLegalModal({ isOpen: true, title, url });
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const isLocal = typeof window !== 'undefined' && (
        window.location.hostname === 'localhost' || 
        window.location.hostname === '127.0.0.1'
      );
      const redirectUrl = isLocal 
        ? `${window.location.origin}/dashboard`
        : 'https://app.styleflo.ai/dashboard';

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar',
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          data: {
            terms_accepted: true,
            terms_accepted_at: new Date().toISOString(),
            terms_version: 'v1.0',
          },
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("Google signin error:", err);
      setError(err?.message || 'Failed to initiate Google sign-in.');
      setLoading(false);
    }
  };

  useEffect(() => {
    const scriptId = 'styleflo-onboard-widget-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = '/embed.js';
      script.setAttribute('data-bot-id', 'styleflo-onboarding-flobot');
      script.setAttribute('data-chatbot-id', 'styleflo-onboarding-flobot');
      script.setAttribute('data-container-id', 'styleflo-widget-container');
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
      {/* Background Decor Ambient Glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none"></div>

      {/* Header Bar (Hidden in iframe embed mode) */}
      {!isEmbed && (
        <header className="h-16 border-b border-gray-800/80 bg-gray-900/60 backdrop-blur-xl px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/20">
              ⚡
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
                StyleFlo Assistant Builder
                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2.5 py-0.5 rounded-full border border-purple-500/30 font-mono font-extrabold uppercase tracking-wider">
                  FloBot AI
                </span>
              </h1>
              <p className="text-[11px] text-gray-400">Official Salon AI Receptionist Builder</p>
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
              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-3.5 py-2 rounded-xl border border-indigo-500/30 transition-all hover:bg-indigo-500/20"
            >
              Sign In ↗
            </Link>
          </div>
        </header>
      )}

      {/* Main Conversational & Google Auth Container */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 relative z-10">
        <div className="w-full max-w-2xl h-[82vh] bg-gray-900/80 border border-gray-800/90 rounded-3xl shadow-2xl overflow-hidden flex flex-col relative backdrop-blur-2xl ring-1 ring-white/10">
          
          {/* Quick 1-Click Google OAuth Top Banner */}
          <div className="bg-gray-950/80 border-b border-gray-800 px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold text-gray-200">1-Click Fast Track:</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-gray-100 text-gray-900 font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-gray-200"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <span className="text-[10px] text-gray-400 hidden md:inline">
                Auto-connects Calendar
              </span>
            </div>
          </div>

          {error && (
            <div className="bg-rose-950/60 border-b border-rose-800 text-rose-300 text-xs px-4 py-2 font-medium">
              {error}
            </div>
          )}

          {/* FloBot Chat Window Container */}
          <div id="styleflo-widget-container" className="w-full h-full flex flex-col relative">
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

          {/* Legal Footer */}
          <div className="px-4 py-2 border-t border-gray-800 bg-gray-950/90 text-center text-[11px] text-gray-400 shrink-0">
            By proceeding, you agree to StyleFlo's{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Terms & Conditions', 'https://styleflo.ai/terms-conditions/')}
              className="text-indigo-400 underline hover:text-indigo-300 font-medium"
            >
              Terms of Service
            </button>{' '}
            and acknowledge our{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Privacy Policy', 'https://styleflo.ai/privacy/')}
              className="text-indigo-400 underline hover:text-indigo-300 font-medium"
            >
              Privacy Policy
            </button>.
          </div>
        </div>
      </div>

      {/* LEGAL MODAL */}
      <LegalModal
        isOpen={legalModal.isOpen}
        onClose={() => setLegalModal({ isOpen: false, title: '', url: '' })}
        title={legalModal.title}
        url={legalModal.url}
      />
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
