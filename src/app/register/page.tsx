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
