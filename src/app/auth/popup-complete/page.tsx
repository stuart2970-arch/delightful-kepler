'use client';

import { useEffect, useState } from 'react';
import { STYLEFLO_AUTH_DONE, appOriginForPostMessage } from '@/lib/env/embed-context';
import { getSupabaseBrowserClient, hasSupabaseBrowserEnv } from '@/lib/supabase-browser';

export default function AuthPopupCompletePage() {
  const [message, setMessage] = useState('Finishing sign-in…');

  useEffect(() => {
    if (!hasSupabaseBrowserEnv()) {
      setMessage('Auth is not configured.');
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const targetOrigin = appOriginForPostMessage();

    const finish = () => {
      try {
        if (window.opener) {
          window.opener.postMessage({ type: STYLEFLO_AUTH_DONE }, targetOrigin);
        }
      } catch {
        // ignore
      }
      setMessage('Signed in. You can close this window.');
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 400);
    };

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          setMessage('Sign-in could not be completed. Close this window and try again.');
          return;
        }
        finish();
      });
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
      else setMessage('No session found. Close this window and try again.');
    });
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 font-sans text-center">
      <p className="text-sm text-slate-700">{message}</p>
    </main>
  );
}