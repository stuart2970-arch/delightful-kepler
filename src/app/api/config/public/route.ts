import { NextResponse } from 'next/server';

/** Public widget + login: Turnstile site keys are public; never return secrets here. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
  return NextResponse.json(
    { turnstileSiteKey },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}