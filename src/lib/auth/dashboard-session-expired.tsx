'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export const DASHBOARD_SESSION_EXPIRED_EVENT = 'styleflo:dashboard-session-expired';
export const DASHBOARD_SESSION_EXPIRED_MESSAGE =
  'Your session has expired — sign in again';

export function notifyDashboardSessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_SESSION_EXPIRED_EVENT));
}

export function DashboardSessionExpiredPrompt() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  const goToLogin = useCallback(() => {
    const returnPath =
      typeof window !== 'undefined'
        ? `${pathname || '/dashboard'}${window.location.search || ''}`
        : '/dashboard';
    const params = new URLSearchParams();
    params.set('next', returnPath);
    window.location.assign(`/login?${params.toString()}`);
  }, [pathname]);

  useEffect(() => {
    const onExpired = () => setVisible(true);
    window.addEventListener(DASHBOARD_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(DASHBOARD_SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alertdialog"
      aria-labelledby="sf-session-expired-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-w-md w-full rounded-2xl bg-white border border-[#EBE7F2] shadow-xl p-6 space-y-4">
        <h2 id="sf-session-expired-title" className="text-lg font-bold text-[#260475]">
          {DASHBOARD_SESSION_EXPIRED_MESSAGE}
        </h2>
        <p className="text-sm text-slate-600">
          For your security, please sign in again to continue managing billing and add-ons.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={goToLogin}
            className="flex-1 bg-[#7E5FBB] hover:bg-[#6B4FA8] text-white font-semibold py-2.5 px-4 rounded-xl transition-colors"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="py-2.5 px-4 rounded-xl border border-slate-200 text-slate-700 font-medium"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}