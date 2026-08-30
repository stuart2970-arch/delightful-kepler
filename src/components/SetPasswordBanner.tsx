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
      throw new Error('Supabase environment variables missing');
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  });

  useEffect(() => {
    // Check if user already set their password or dismissed the banner
    const isDismissedOrSet = typeof window !== 'undefined' && (
      localStorage.getItem('styleflo_password_set') === 'true' ||
      localStorage.getItem('styleflo_password_banner_dismissed') === 'true'
    );

    if (!isDismissedOrSet) {
      setIsVisible(true);
    }
  }, []);

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
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      if (typeof window !== 'undefined') {
        localStorage.setItem('styleflo_password_set', 'true');
      }

      setMessage({ text: '🔐 Password set successfully! You can now log in anytime using your password.', isError: false });
      setTimeout(() => {
        setIsVisible(false);
      }, 4000);
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
    <div className="mb-6 p-5 bg-gradient-to-r from-[#260475] to-[#4c1d95] text-white rounded-2xl shadow-lg border border-purple-500/30 transition-all duration-300 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-purple-300 hover:text-white text-xs p-1 rounded-lg transition-colors"
        title="Dismiss for now"
      >
        ✕
      </button>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 pr-6">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-xl shrink-0 shadow-inner">
            🔐
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-white">Set Your Account Password</h3>
            <p className="text-xs text-purple-200 mt-0.5">
              Create a password so you can log in directly to your StyleFlo dashboard next time.
            </p>
          </div>
        </div>

        <form onSubmit={handleSetPassword} className="flex flex-col sm:flex-row items-center gap-2.5 w-full lg:w-auto">
          <input
            type="password"
            placeholder="New Password (min 6 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            className="px-3.5 py-2 text-xs rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 w-full sm:w-44 transition-all"
          />
          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            className="px-3.5 py-2 text-xs rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 w-full sm:w-44 transition-all"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-xs font-bold bg-white text-[#260475] hover:bg-purple-50 rounded-xl transition-all shadow-md shrink-0 w-full sm:w-auto disabled:opacity-50 active:scale-95"
          >
            {loading ? 'Saving...' : 'Save Password'}
          </button>
        </form>
      </div>

      {message && (
        <div className={`mt-3 pt-2 border-t border-white/10 text-xs font-medium ${message.isError ? 'text-red-300' : 'text-emerald-300'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
