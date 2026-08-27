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
    <main className="min-h-screen flex flex-col bg-[#f2f3f5] text-[#212326] font-sans relative overflow-hidden">
      {/* Header Bar (Styled matching app.styleflo.ai/dashboard) */}
      {!isEmbed && (
        <header className="h-16 bg-[#260475] px-6 flex items-center justify-between shrink-0 z-20 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center font-bold text-white shadow-sm">
              ⚡
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-2">
                StyleFlo Assistant Builder
                <span className="text-[10px] bg-white/15 text-white px-2.5 py-0.5 rounded-full border border-white/20 font-mono font-extrabold uppercase tracking-wider">
                  FloBot AI
                </span>
              </h1>
              <p className="text-[11px] text-white/70">Official Salon AI Receptionist Builder</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/register"
              className="text-xs font-semibold text-white/80 hover:text-white transition-colors"
            >
              Direct Register
            </Link>
            <Link
              href="/login"
              className="text-xs font-bold text-white bg-[#198fd9] hover:bg-[#1478b8] px-3.5 py-2 rounded-xl transition-all shadow-sm"
            >
              Sign In ↗
            </Link>
          </div>
        </header>
      )}

      {/* Main Conversational & Google Auth Container (Dashboard Theme) */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 relative z-10">
        <div className="w-full max-w-2xl h-[82vh] bg-white border border-[#e2e8f0] rounded-3xl shadow-xl overflow-hidden flex flex-col relative">
          
          {/* Quick 1-Click Google OAuth Top Banner */}
          <div className="bg-[#f9f9fb] border-b border-[#e2e8f0] px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#65bd7d] animate-pulse"></span>
              <span className="text-xs font-bold text-[#212326]">1-Click Fast Track:</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full sm:w-auto px-4 py-2 bg-[#260475] hover:bg-[#1f0360] text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <svg className="w-4 h-4 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
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

              <span className="text-[10px] text-[#434549] hidden md:inline font-medium">
                Auto-connects Calendar
              </span>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border-b border-rose-200 text-rose-700 text-xs px-4 py-2 font-medium">
              {error}
            </div>
          )}

          {/* FloBot Chat Window Container */}
          <div id="styleflo-widget-container" className="w-full flex-1 min-h-0 flex flex-col relative bg-white overflow-hidden">
            {!botLoaded && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="w-12 h-12 border-4 border-[#260475] border-t-transparent rounded-full animate-spin"></div>
                <div>
                  <h3 className="text-base font-bold text-[#212326]">Initializing FloBot...</h3>
                  <p className="text-xs text-[#434549] mt-1">Connecting to StyleFlo AI Assistant Builder</p>
                </div>
              </div>
            )}
          </div>

          {/* Legal Footer */}
          <div className="px-4 py-2.5 border-t border-[#e2e8f0] bg-[#f9f9fb] text-center text-[11px] text-[#434549] shrink-0 font-medium">
            By proceeding, you agree to StyleFlo's{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Terms & Conditions', 'https://styleflo.ai/terms-conditions/')}
              className="text-[#260475] underline hover:text-[#198fd9] font-bold"
            >
              Terms of Service
            </button>{' '}
            and acknowledge our{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Privacy Policy', 'https://styleflo.ai/privacy/')}
              className="text-[#260475] underline hover:text-[#198fd9] font-bold"
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
        <div className="min-h-screen bg-[#f2f3f5] text-[#212326] flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-[#260475] border-t-transparent rounded-full"></div>
        </div>
      }
    >
      <OnboardContent />
    </Suspense>
  );
}
