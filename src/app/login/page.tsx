"use client";

import { useEffect, useState } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  );

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        router.push('/dashboard');
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

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
          <p className="text-sm text-gray-400">Sign in to manage your AI chatbots</p>
        </div>

        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#4F46E5',
                  brandAccent: '#4338ca',
                  inputBackground: 'rgba(17, 24, 39, 0.8)',
                  inputText: 'white',
                  inputBorder: '#374151',
                  inputBorderHover: '#4F46E5',
                  inputBorderFocus: '#4F46E5',
                  messageText: '#9CA3AF',
                  anchorTextColor: '#818CF8',
                  dividerBackground: '#374151',
                },
                space: {
                  inputPadding: '12px 16px',
                  buttonPadding: '12px 16px',
                },
                radii: {
                  borderRadiusButton: '12px',
                  buttonBorderRadius: '12px',
                  inputBorderRadius: '12px',
                },
              },
            },
            className: {
              container: 'styleflo-auth-container',
              button: 'styleflo-auth-btn font-semibold shadow-lg shadow-indigo-500/10 transition-all',
              input: 'transition-all focus:ring-1 focus:ring-indigo-500',
              label: 'text-xs font-semibold text-gray-400 mb-1.5',
            },
          }}
          theme="dark"
          providers={['google', 'github']}
          redirectTo={`${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard`}
          additionalData={[
            {
              name: 'full_name',
              label: 'Full Name',
              type: 'text',
              placeholder: 'Jane Doe',
              required: true,
            },
            {
              name: 'company_name',
              label: 'Company / Salon Name',
              type: 'text',
              placeholder: 'Rosser Hairdressing',
              required: true,
            },
            {
              name: 'website_url',
              label: 'Website URL',
              type: 'url',
              placeholder: 'https://rosserhairdressing.com',
              required: true,
            },
          ]}
        />
      </div>
    </main>
  );
}
