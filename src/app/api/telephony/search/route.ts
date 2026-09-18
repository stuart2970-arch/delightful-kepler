import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

async function getSupabaseAuthClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Safe to ignore in Server Components
        }
      },
    },
  });
}

function formatUkDisplayNumber(rawNumber: string): string {
  // Convert +441513210044 to 0151 321 0044
  if (!rawNumber) return rawNumber;
  let formatted = rawNumber;
  if (formatted.startsWith('+44')) {
    formatted = '0' + formatted.slice(3);
  }
  // Mobile: 07xxx xxxxxx
  if (formatted.startsWith('07') && formatted.length === 11) {
    return `${formatted.slice(0, 5)} ${formatted.slice(5)}`;
  }
  // Local 4-digit code: 0151 xxx xxxx
  if (formatted.length === 11) {
    return `${formatted.slice(0, 4)} ${formatted.slice(4, 7)} ${formatted.slice(7)}`;
  }
  // London / 3-digit: 020 xxxx xxxx
  if (formatted.startsWith('02') && formatted.length === 11) {
    return `${formatted.slice(0, 3)} ${formatted.slice(3, 7)} ${formatted.slice(7)}`;
  }
  return formatted;
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthClient();
    let user = (await supabase.auth.getUser()).data?.user;

    // Fallback to Bearer token in Authorization header
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { number_type, area_code } = body;
    const isMobile = number_type === 'mobile';

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error('[Telephony Search] Missing Twilio credentials');
      return NextResponse.json({ error: 'Telephony service is not configured' }, { status: 500 });
    }

    const client = twilio(accountSid, authToken);
    const country = process.env.TWILIO_PHONE_COUNTRY || 'GB';

    let available: any[] = [];

    if (isMobile) {
      console.log(`[Telephony Search] Searching mobile numbers for country ${country}...`);
      available = await client.availablePhoneNumbers(country).mobile.list({ limit: 6 });
    } else {
      const searchParams: any = { limit: 6 };
      if (area_code) {
        const cleanCode = area_code.replace(/^0+/, '').trim();
        if (cleanCode) searchParams.areaCode = cleanCode;
      }
      console.log(`[Telephony Search] Searching local numbers for country ${country}...`, searchParams);
      available = await client.availablePhoneNumbers(country).local.list(searchParams);

      // Fallback if specific area code returned no matches
      if ((!available || available.length === 0) && searchParams.areaCode) {
        console.log(`[Telephony Search] No numbers for areaCode ${searchParams.areaCode}, searching general local...`);
        available = await client.availablePhoneNumbers(country).local.list({ limit: 6 });
      }
    }

    const numbers = (available || []).map((num: any) => ({
      phoneNumber: num.phoneNumber,
      displayNumber: formatUkDisplayNumber(num.phoneNumber),
      friendlyName: num.friendlyName || formatUkDisplayNumber(num.phoneNumber),
      locality: num.locality || (isMobile ? 'UK Mobile' : 'UK Local'),
      postalCode: num.postalCode || null,
      isoCountry: num.isoCountry || country,
      numberType: isMobile ? 'mobile' : 'local',
    }));

    return NextResponse.json({
      success: true,
      numbers,
      count: numbers.length,
      searchedAreaCode: area_code || null,
    });
  } catch (error: any) {
    console.error('[Telephony Search API] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to search available numbers' }, { status: 500 });
  }
}
