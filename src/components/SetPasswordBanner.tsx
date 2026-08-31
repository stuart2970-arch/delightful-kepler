'use client';

import React, { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function SetPasswordBanner() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const [supabase] = useState(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  });

  useEffect(() => {
    const checkDisplayConditions = async () => {
      if (typeof window === 'undefined') return;

      const isDismissedOrSet = 
        localStorage.getItem('styleflo_password_set') === 'true' ||
        localStorage.getItem('styleflo_password_banner_dismissed') === 'true';

      if (isDismissedOrSet) {
        setIsVisible(false);
        return;
      }

      if (!supabase) {
        // Fallback for environment without initialized Supabase client
        setIsVisible(!isDismissedOrSet);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setIsVisible(false);
          return;
        }

        const user = session.user;
        const hasSetPasswordMeta = user.user_metadata?.has_set_password === true;
        if (hasSetPasswordMeta) {
          localStorage.setItem('styleflo_password_set', 'true');
          setIsVisible(false);
          return;
        }

        // Check if user authenticated via magic link
        const amrList: Array<{ method: string }> = (session as any)?.amr || user.app_metadata?.amr || [];
        const isMagicLinkLogin = amrList.some(
          (entry) => entry.method === 'magiclink' || entry.method === 'otp'
        ) || window.location.search.includes('type=magiclink');

        // Only display if logged in via magic link and password hasn't been set yet
        setIsVisible(isMagicLinkLogin);
      } catch (err) {
        console.error('Error checking password banner conditions:', err);
        setIsVisible(false);
      }
    };

    checkDisplayConditions();
  }, [supabase]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters long.', isError: true });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'Passwords do not match.', isError: true });
      return;
    }

    setLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({
          password: newPassword,
          data: { has_set_password: true }
        });
        if (error) throw error;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('styleflo_password_set', 'true');
      }

      setMessage({ text: '🔐 Password set successfully! You can now log in anytime using your password.', isError: false });
      setTimeout(() => {
        setIsVisible(false);
      }, 3000);
    } catch (err: any) {
      console.error('Error setting password:', err);
      setMessage({ text: err?.message || 'Failed to update password. Please try again.', isError: true });
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('styleflo_password_banner_dismissed', 'true');
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div 
      className="mb-6 p-4 sm:p-6 pr-10 sm:pr-12 rounded-2xl shadow-xl transition-all duration-300 relative border border-indigo-400/40"
      style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #260475 50%, #31107e 100%)', color: '#ffffff' }}
    >
      <button
        onClick={handleDismiss}
        className="absolute top-3.5 right-3.5 text-white/70 hover:text-white hover:bg-white/10 w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors"
        title="Dismiss banner"
      >
        ✕
      </button>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 flex-1 pr-2">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center text-xl shrink-0 shadow-inner border border-white/20">
            🔐
          </div>
          <div>
            <h3 className="font-extrabold text-sm sm:text-base tracking-tight text-white m-0">
              Set Your Account Password
            </h3>
            <p className="text-xs text-indigo-100/90 mt-0.5 m-0 leading-relaxed max-w-xl">
              Create a password so you can log in directly to your StyleFlo dashboard next time.
            </p>
          </div>
        </div>

        <form onSubmit={handleSetPassword} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto shrink-0">
          <input
            type="password"
            placeholder="New Password (min 6 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            className="px-3.5 py-2.5 text-xs rounded-xl bg-white text-gray-900 placeholder-gray-400 font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300 w-full sm:w-48 lg:w-52 shadow-sm border border-purple-200 shrink-0"
          />
          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            className="px-3.5 py-2.5 text-xs rounded-xl bg-white text-gray-900 placeholder-gray-400 font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300 w-full sm:w-40 lg:w-44 shadow-sm border border-purple-200 shrink-0"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 text-xs font-black bg-white text-[#260475] hover:bg-purple-50 rounded-xl transition-all shadow-md shrink-0 w-full sm:w-auto disabled:opacity-50 active:scale-95 border border-white whitespace-nowrap"
          >
            {loading ? 'Saving...' : 'Save Password'}
          </button>
        </form>
      </div>

      {message && (
        <div className={`mt-3 pt-2.5 border-t border-white/20 text-xs font-bold ${message.isError ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}

