"use client";

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import LegalModal from '@/components/LegalModal';

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalModal, setLegalModal] = useState<{ isOpen: boolean; title: string; url: string }>({
    isOpen: false,
    title: '',
    url: '',
  });

  const openLegalModal = (title: string, url: string) => {
    setLegalModal({ isOpen: true, title, url });
  };
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [customSlug, setCustomSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<{
    checking: boolean;
    available: boolean;
    slug: string;
    url: string;
    suggestions: string[];
  } | null>(null);

  useEffect(() => {
    if (isLogin) return;
    const nameToCheck = customSlug || companyName;
    if (!nameToCheck.trim()) {
      setSlugStatus(null);
      return;
    }

    setSlugStatus(prev => ({
      checking: true,
      available: prev?.available ?? true,
      slug: prev?.slug ?? '',
      url: prev?.url ?? '',
      suggestions: prev?.suggestions ?? []
    }));

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenants/check-slug?name=${encodeURIComponent(nameToCheck)}`);
        if (res.ok) {
          const data = await res.json();
          setSlugStatus({
            checking: false,
            available: data.available,
            slug: data.slug,
            url: data.url,
            suggestions: data.suggestions || [],
          });
        }
      } catch (e) {
        console.error('Slug check failed', e);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [companyName, customSlug, isLogin]);

  // Initialize Supabase client
  const [supabase] = useState(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables are missing');
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  });

  useEffect(() => {
    // Handle PKCE auth code exchange if present in URL
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code) {
        supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
          if (error) {
            console.error('Error exchanging code for session:', error);
          } else {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
          }
        });
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
        if (isEmbedded && window.top) {
          const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
          const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';
          window.top.location.href = wpAppUrl;
        } else {
          router.push('/dashboard');
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        if (slugStatus && !slugStatus.available) {
          throw new Error(`The URL slug "${slugStatus.slug}" is already registered by another business. Please pick one of the available suggestions below.`);
        }

        const finalSlug = slugStatus?.slug || companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const isLocal = typeof window !== 'undefined' && (
          window.location.hostname === 'localhost' || 
          window.location.hostname === '127.0.0.1'
        );
        const redirectUrl = isLocal 
          ? `${window.location.origin}/login`
          : 'https://app.styleflo.ai/login';

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              full_name: fullName,
              company_name: companyName,
              website_url: websiteUrl,
              slug: finalSlug,
            },
          },
        });
        if (error) throw error;
        
        if (data?.session === null) {
          setSuccessMessage("Account created successfully! Please check your email to verify your account.");
        }
      }
    } catch (err: any) {
      console.error("Signup error:", err);
      let errorMsg = 'An error occurred during authentication.';
      if (typeof err === 'string') {
        errorMsg = err;
      } else if (err && typeof err === 'object') {
        if (typeof err.message === 'string' && err.message.trim()) {
          errorMsg = err.message;
        } else if (typeof err.error_description === 'string' && err.error_description.trim()) {
          errorMsg = err.error_description;
        } else if (typeof err.error === 'string' && err.error.trim()) {
          errorMsg = err.error;
        } else if (err.error && typeof err.error.message === 'string' && err.error.message.trim()) {
          errorMsg = err.error.message;
        } else {
          try {
            const str = JSON.stringify(err);
            if (str && str !== '{}') errorMsg = str;
          } catch {
            errorMsg = String(err);
          }
        }
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
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
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error("Google signin error:", err);
      setError(err?.message || 'Failed to initiate Google sign-in.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 p-4 font-sans relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/20 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md bg-gray-900/60 border border-gray-800 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10 backdrop-blur-xl">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Welcome to StyleFlo</h1>
          <p className="text-sm text-gray-400">
            {isLogin ? 'Sign in to manage your AI chatbots' : 'Create an account to get started'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-sm font-medium">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/50 rounded-xl text-green-400 text-sm font-medium">
            {successMessage}
          </div>
        )}

        {/* 1-CLICK GOOGLE SIGN IN BUTTON */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full h-12 bg-white hover:bg-gray-100 text-gray-900 font-bold text-sm rounded-xl shadow-md flex items-center justify-center gap-3 transition-all active:scale-[0.99] mb-3 border border-gray-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
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

        <p className="text-[11px] text-gray-400 text-center mb-5 leading-normal">
          By continuing with Google, you agree to StyleFlo's{' '}
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
        </p>

        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-gray-800 w-full"></div>
          <span className="bg-gray-900 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-bold shrink-0">Or continue with credentials</span>
          <div className="border-t border-gray-800 w-full"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              placeholder="••••••••"
            />
          </div>

          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="Sarah Jenkins"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Company / Salon Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    setCustomSlug('');
                  }}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="StyleFlo Lounge"
                />

                {/* Real-time URL preview & Availability indicator */}
                {slugStatus && slugStatus.slug && (
                  <div className={`mt-2.5 p-3 rounded-xl border text-xs transition-all ${
                    slugStatus.checking
                      ? 'bg-gray-800/80 border-gray-700 text-gray-400'
                      : slugStatus.available
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}>
                    <div className="flex items-center justify-between font-mono font-medium">
                      <span className="truncate max-w-[260px]">{slugStatus.url}</span>
                      {slugStatus.checking ? (
                        <span className="text-[10px] text-gray-400 animate-pulse">Checking availability...</span>
                      ) : slugStatus.available ? (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-sans font-bold">
                          ✓ Available
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-sans font-bold">
                          ✕ Already Taken
                        </span>
                      )}
                    </div>

                    {/* Suggestions list when URL is taken */}
                    {!slugStatus.checking && !slugStatus.available && slugStatus.suggestions.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-red-500/20 font-sans">
                        <p className="text-[11px] text-gray-300 font-semibold mb-1.5">Suggested available URLs:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {slugStatus.suggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => setCustomSlug(suggestion)}
                              className="px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 rounded-lg text-xs font-mono font-semibold transition-all hover:scale-105 active:scale-95"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Website URL</label>
                <input
                  type="url"
                  required
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="https://example.com"
                />
              </div>
              {/* REQUIRED TERMS CHECKBOX FOR SIGNUP */}
              <div className="flex items-start gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="loginTermsAccepted"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-700 bg-gray-950 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="loginTermsAccepted" className="text-xs text-gray-300 leading-snug">
                  I agree to StyleFlo's{' '}
                  <button
                    type="button"
                    onClick={() => openLegalModal('Terms & Conditions', 'https://styleflo.ai/terms-conditions/')}
                    className="text-indigo-400 underline hover:text-indigo-300 font-bold"
                  >
                    Terms of Service
                  </button>{' '}
                  and{' '}
                  <button
                    type="button"
                    onClick={() => openLegalModal('Privacy Policy', 'https://styleflo.ai/privacy/')}
                    className="text-indigo-400 underline hover:text-indigo-300 font-bold"
                  >
                    Privacy Policy
                  </button>.
                </label>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading || (!isLogin && !termsAccepted)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl px-4 py-3 shadow-lg shadow-indigo-500/20 transition-all focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
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
