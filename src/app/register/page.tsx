"use client";

import { useEffect, useState, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import LegalModal from '@/components/LegalModal';

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const planParam = searchParams.get('plan') || 'starter';
  const promoParam = searchParams.get('promo') || '1monthfree';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [duplicateEmailDetected, setDuplicateEmailDetected] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const [customSlug, setCustomSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<{
    checking: boolean;
    available: boolean;
    slug: string;
    url: string;
    suggestions: string[];
  } | null>(null);

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
  }, [companyName, customSlug]);

  const getPlanBadge = () => {
    switch (planParam.toLowerCase()) {
      case 'basic':
        return { name: 'Basic Tier', price: '£5.99/mo', tag: '1st Month Free' };
      case 'premium':
        return { name: 'Premium Tier', price: '£79/mo', tag: '1st Month Free (Most Popular)' };
      case 'ultimate':
        return { name: 'Ultimate Tier', price: 'POA', tag: 'Enterprise Support' };
      default:
        return { name: 'Starter Tier', price: '£29/mo', tag: '1st Month Free' };
    }
  };

  const planInfo = getPlanBadge();

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalModal, setLegalModal] = useState<{ isOpen: boolean; title: string; url: string }>({
    isOpen: false,
    title: '',
    url: '',
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

  const handleSendMagicLink = async () => {
    setSendingMagicLink(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), clientEmail: email.trim(), name: fullName }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.redirectUrl || data.success) {
        setMagicLinkSent(true);
        setDuplicateEmailDetected(false);
      } else if (data.error) {
        setError(data.error);
      } else {
        setMagicLinkSent(true);
        setDuplicateEmailDetected(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to send magic login link.');
    } finally {
      setSendingMagicLink(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsAccepted) {
      setError("You must agree to StyleFlo's Terms of Service and Privacy Policy to continue.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setDuplicateEmailDetected(false);
    setMagicLinkSent(false);

    try {
      // 1. Verify master email address uniqueness across all account profiles
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.exists) {
          setDuplicateEmailDetected(true);
          setLoading(false);
          return;
        }
      }

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
            selected_plan: planParam,
            promo_applied: promoParam,
            terms_accepted: true,
            terms_accepted_at: new Date().toISOString(),
            terms_version: 'v1.0',
          },
        },
      });
      if (error) throw error;
      
      if (data?.session === null) {
        setSuccessMessage("Account created successfully! Please check your email to verify your account and claim your 1st month free.");
      } else {
        router.push(`/dashboard?plan=${planParam}&promo=${promoParam}`);
      }
    } catch (err: any) {
      console.error("Signup error:", err);
      let errorMsg = 'An error occurred during registration.';
      if (typeof err === 'string') {
        errorMsg = err;
      } else if (err?.message) {
        errorMsg = err.message;
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0B091A] p-4 font-sans relative overflow-hidden">
      {/* StyleFlo Ambient Glow Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#260475]/35 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#7E5FBB]/25 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md bg-[#130F26]/90 border border-purple-900/40 rounded-3xl p-8 md:p-10 shadow-[0_20px_50px_rgba(38,4,117,0.35)] relative z-10 backdrop-blur-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#260475] via-[#4A1F52] to-[#7E5FBB] border border-purple-400/30 p-2.5 mx-auto mb-4 flex items-center justify-center shadow-xl shadow-purple-950/60 transition-transform duration-300 hover:scale-105">
            <img 
              src="https://styleflo.ai/wp-content/uploads/2026/07/icon.png" 
              alt="StyleFlo.ai Logo" 
              className="w-full h-full object-contain drop-shadow" 
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = 'none';
                if (target.nextElementSibling) target.nextElementSibling.classList.remove('hidden');
              }}
            />
            <span className="hidden text-white font-black text-2xl tracking-tighter">SF</span>
          </div>
          <h1 className="text-2xl font-black text-white mb-1 tracking-tight font-sans">
            STYLE<span className="text-[#9678D3]">FLO</span><span className="text-xs text-purple-300 font-mono ml-0.5 font-normal">.AI</span>
          </h1>
          <p className="text-xs text-purple-200/80 font-medium">Get your 24/7 AI Receptionist ready in under 5 minutes</p>
        </div>

        {/* Selected Plan Banner */}
        <div className="bg-gradient-to-r from-[#260475]/60 to-[#7E5FBB]/40 border border-purple-500/30 rounded-2xl p-4 mb-6 text-center space-y-1 shadow-inner">
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-200 bg-purple-500/30 px-2.5 py-0.5 rounded-full border border-purple-400/30">
            🎉 {planInfo.tag}
          </span>
          <h2 className="text-base font-bold text-white mt-1">{planInfo.name} Subscription</h2>
          <p className="text-xs text-purple-200/90">Try 30 days risk-free. Cancel anytime.</p>
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-300 text-xs p-3.5 rounded-xl mb-5 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {duplicateEmailDetected && (
          <div className="bg-amber-950/70 border border-amber-500/50 rounded-2xl p-5 mb-6 text-left space-y-3 shadow-lg animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
              <span className="text-xl">⚠️</span>
              <span>Email Already Registered</span>
            </div>
            <p className="text-xs text-amber-200/90 leading-relaxed">
              The email <strong className="text-white underline">{email}</strong> is already registered to an existing StyleFlo account. Master emails cannot be linked to more than one account.
            </p>
            <p className="text-xs text-amber-100 font-semibold">
              Would you like us to send a magic login link to log into your account?
            </p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={handleSendMagicLink}
                disabled={sendingMagicLink}
                className="bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
              >
                {sendingMagicLink ? 'Sending Link...' : '📩 Send Magic Login Link'}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/login?email=${encodeURIComponent(email)}`)}
                className="bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl border border-gray-700 transition-all text-center"
              >
                🔑 Sign In with Password
              </button>
            </div>
          </div>
        )}

        {magicLinkSent && (
          <div className="bg-emerald-950/70 border border-emerald-500/50 rounded-2xl p-5 mb-6 text-left space-y-2 shadow-lg animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
              <span className="text-xl">✨</span>
              <span>Magic Login Link Sent!</span>
            </div>
            <p className="text-xs text-emerald-200/90 leading-relaxed">
              We've sent a magic login link to <strong className="text-white underline">{email}</strong>. Please check your inbox (and spam folder) to sign in directly.
            </p>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-xs p-4 rounded-xl mb-5 font-medium leading-relaxed">
            {successMessage}
          </div>
        )}

        {/* PROMINENT FEATURED 1-CLICK GOOGLE SIGN IN */}
        <div className="bg-gradient-to-b from-[#F4EFFC] via-purple-50/50 to-white border-2 border-[#7E5FBB]/30 rounded-2xl p-4.5 mb-5 shadow-[0_6px_20px_rgba(126,95,187,0.12)] text-center transition-all hover:border-[#7E5FBB]/50">
          <div className="flex items-center justify-center gap-1.5 mb-2.5">
            <span className="text-[10px] font-black uppercase tracking-wider bg-[#260475] text-white px-2.5 py-0.5 rounded-full shadow-xs">⚡ RECOMMENDED</span>
            <span className="text-xs font-bold text-[#4A1F52]">Fast 1-Click Setup</span>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full h-13 bg-white hover:bg-slate-50 text-[#0F172A] font-extrabold text-sm sm:text-base rounded-xl shadow-md border-2 border-[#EBE7F2] hover:border-[#7E5FBB]/40 flex items-center justify-center gap-3 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
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
            <span>Register in 1-Click with Google</span>
          </button>

          <p className="text-[11px] text-[#64748B] text-center mt-2.5 leading-snug">
            By continuing with Google, you agree to StyleFlo's{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Terms & Conditions', 'https://styleflo.ai/terms-conditions/')}
              className="text-[#7E5FBB] underline hover:text-[#4A1F52] font-semibold"
            >
              Terms of Service
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={() => openLegalModal('Privacy Policy', 'https://styleflo.ai/privacy/')}
              className="text-[#7E5FBB] underline hover:text-[#4A1F52] font-semibold"
            >
              Privacy Policy
            </button>.
          </p>
        </div>

        <div className="relative flex items-center justify-center my-6">
          <div className="border-t border-slate-200 w-full"></div>
          <span className="bg-white border border-slate-200 px-3 py-1 rounded-full text-[10px] uppercase tracking-wider text-slate-500 font-bold shrink-0 shadow-2xs">Or register manually with email</span>
          <div className="border-t border-slate-200 w-full"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-purple-200/90 mb-1.5 uppercase tracking-wider">Business / Salon Name</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. StyleFlo Beauty Lounge"
              className="w-full h-11 bg-[#090715]/90 border border-purple-900/50 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-[#9678D3] focus:ring-2 focus:ring-[#7E5FBB]/40 transition-colors placeholder-purple-300/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-purple-200/90 mb-1.5 uppercase tracking-wider">Your Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Sarah Jenkins"
              className="w-full h-11 bg-[#090715]/90 border border-purple-900/50 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-[#9678D3] focus:ring-2 focus:ring-[#7E5FBB]/40 transition-colors placeholder-purple-300/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-purple-200/90 mb-1.5 uppercase tracking-wider">Work Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@salon.com"
              className="w-full h-11 bg-[#090715]/90 border border-purple-900/50 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-[#9678D3] focus:ring-2 focus:ring-[#7E5FBB]/40 transition-colors placeholder-purple-300/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-purple-200/90 mb-1.5 uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full h-11 bg-[#090715]/90 border border-purple-900/50 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-[#9678D3] focus:ring-2 focus:ring-[#7E5FBB]/40 transition-colors placeholder-purple-300/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-purple-200/90 mb-1.5 uppercase tracking-wider">Website URL (Optional)</label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://www.mysalon.co.uk"
              className="w-full h-11 bg-[#090715]/90 border border-purple-900/50 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-[#9678D3] focus:ring-2 focus:ring-[#7E5FBB]/40 transition-colors placeholder-purple-300/30"
            />
          </div>

          {/* REQUIRED TERMS CHECKBOX */}
          <div className="flex items-start gap-2.5 pt-2">
            <input
              type="checkbox"
              id="termsAccepted"
              required
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-purple-900 bg-[#090715] text-[#7E5FBB] focus:ring-[#7E5FBB]"
            />
            <label htmlFor="termsAccepted" className="text-xs text-purple-200/90 leading-snug">
              I agree to StyleFlo's{' '}
              <button
                type="button"
                onClick={() => openLegalModal('Terms & Conditions', 'https://styleflo.ai/terms-conditions/')}
                className="text-[#9678D3] underline hover:text-purple-200 font-bold"
              >
                Terms of Service
              </button>{' '}
              and{' '}
              <button
                type="button"
                onClick={() => openLegalModal('Privacy Policy', 'https://styleflo.ai/privacy/')}
                className="text-[#9678D3] underline hover:text-purple-200 font-bold"
              >
                Privacy Policy
              </button>.
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !termsAccepted}
            className="w-full h-12 bg-gradient-to-r from-[#260475] via-[#7E5FBB] to-[#9678D3] hover:from-[#1f0360] hover:to-[#7E5FBB] text-white font-bold text-sm rounded-xl shadow-lg shadow-purple-950/50 active:scale-[0.99] transition-all disabled:opacity-50 mt-2"
          >
            {loading ? 'Creating Account & Claiming Free Month...' : `Claim 1st Month Free on ${planInfo.name}`}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-purple-300/70 border-t border-purple-900/60 pt-4">
          Already have an account?{' '}
          <a href="/login" className="text-[#9678D3] font-bold hover:underline">
            Sign In
          </a>
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

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  );
}
