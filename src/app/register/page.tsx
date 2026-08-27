"use client";

import { useEffect, useState, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
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
          },
        },
      });
      if (error) throw error;
      
      if (data?.session === null) {
        setSuccessMessage("Account created successfully! Please check your email to verify your account and claim your 1st month free.");
      } else {
        // Logged in directly
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
        {/* Selected Plan Banner */}
        <div className="bg-gradient-to-r from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 mb-6 text-center space-y-1">
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-purple-300 bg-purple-500/20 px-2.5 py-0.5 rounded-full border border-purple-400/30">
            🎉 {planInfo.tag}
          </span>
          <h2 className="text-base font-bold text-white mt-1">{planInfo.name} Subscription</h2>
          <p className="text-xs text-gray-300">Try 30 days risk-free. Cancel anytime.</p>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-1 tracking-tight">Create Your StyleFlo Account</h1>
          <p className="text-xs text-gray-400">Get your AI Receptionist ready in under 5 minutes</p>
        </div>

        {error && (
          <div className="bg-rose-950/40 border border-rose-800 text-rose-300 text-xs p-3.5 rounded-xl mb-5 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs p-4 rounded-xl mb-5 font-medium leading-relaxed">
            {successMessage}
          </div>
        )}

        {/* 1-CLICK GOOGLE SIGN IN BUTTON */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full h-12 bg-white hover:bg-gray-100 text-gray-900 font-bold text-sm rounded-xl shadow-md flex items-center justify-center gap-3 transition-all active:scale-[0.99] mb-5 border border-gray-200"
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

        <div className="relative flex items-center justify-center my-4">
          <div className="border-t border-gray-800 w-full"></div>
          <span className="bg-gray-900 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-bold shrink-0">Or register with email</span>
          <div className="border-t border-gray-800 w-full"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">Business / Salon Name</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. StyleFlo Beauty Lounge"
              className="w-full h-11 bg-gray-950 border border-gray-800 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">Your Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Sarah Jenkins"
              className="w-full h-11 bg-gray-950 border border-gray-800 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">Work Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@salon.com"
              className="w-full h-11 bg-gray-950 border border-gray-800 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full h-11 bg-gray-950 border border-gray-800 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 mb-1.5 uppercase tracking-wider">Website URL (Optional)</label>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://www.mysalon.co.uk"
              className="w-full h-11 bg-gray-950 border border-gray-800 rounded-xl px-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/20 active:scale-[0.99] transition-all disabled:opacity-50 mt-2"
          >
            {loading ? 'Creating Account & Claiming Free Month...' : `Claim 1st Month Free on ${planInfo.name}`}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-400 border-t border-gray-800/80 pt-4">
          Already have an account?{' '}
          <a href="/login" className="text-indigo-400 font-bold hover:underline">
            Sign In
          </a>
        </div>
      </div>
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
