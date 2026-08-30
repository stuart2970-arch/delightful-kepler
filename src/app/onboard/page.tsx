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

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar',
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
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
      if (data?.url) {
        if (typeof window !== 'undefined' && window.top && window.top !== window) {
          window.top.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      }
    } catch (err: any) {
      console.error("Google signin error:", err);
      setError(err?.message || 'Failed to initiate Google sign-in.');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).stylefloGoogleSignIn = handleGoogleSignIn;
    }
  }, []);

  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/chatbots/styleflo-onboarding-flobot')
      .then((res) => res.json())
      .then((data) => {
        if (data?.agentAvatarUrl || data?.avatarUrl) {
          setBotAvatarUrl(data.agentAvatarUrl || data.avatarUrl);
        }
      })
      .catch((err) => console.error('Failed to fetch bot avatar:', err));
  }, []);

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
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center font-bold text-white shadow-sm overflow-hidden">
              {botAvatarUrl ? (
                <img src={botAvatarUrl} alt="FloBot Avatar" className="w-full h-full object-cover rounded-xl" />
              ) : (
                <span>⚡</span>
              )}
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
