import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  isEmailConfirmOtpType,
  resolveAuthCallbackNext,
} from '@/lib/auth/email-confirmation-redirect'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const searchParams = requestUrl.searchParams
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const requestedNext = searchParams.get('next')

  const cookieStore = await cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_callback_failed`)
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Safe to ignore in Server Components / Route Handlers
        }
      },
    },
  })

  if (token_hash && type && isEmailConfirmOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'signup' | 'email' | 'email_change' | 'invite' | 'magiclink' | 'recovery',
    })
    if (error) {
      console.error('[Auth Callback] verifyOtp token_hash error:', error.message)
      return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`)
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const next = resolveAuthCallbackNext({
      requestedNext,
      type,
      userMetadata: user?.user_metadata as Record<string, unknown> | undefined,
    })

    console.log(`[Auth Callback] Verified token_hash (${type}). Redirecting to ${next}...`)
    const destination = next.startsWith('http') ? next : `${requestUrl.origin}${next}`
    return NextResponse.redirect(destination)
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const next = resolveAuthCallbackNext({
        requestedNext,
        type: searchParams.get('type'),
        userMetadata: user?.user_metadata as Record<string, unknown> | undefined,
      })
      console.log(`[Auth Callback] Exchanged code for session. Redirecting to ${next}...`)
      const destination = next.startsWith('http') ? next : `${requestUrl.origin}${next}`
      return NextResponse.redirect(destination)
    }
    console.error('[Auth Callback] Code exchange error:', error.message)
    return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_callback_failed`)
}