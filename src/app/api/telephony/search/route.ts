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

function sanitizeUkAreaCode(input?: unknown): string {
  if (!input || (typeof input !== 'string' && typeof input !== 'number')) return '';
  let code = input.toString().trim();
  // Strip +44, 0044, or leading 0s
  code = code.replace(/^\+44/, '').replace(/^0044/, '').replace(/^0+/, '');
  // Remove spaces or hyphens
  code = code.replace(/[\s-]/g, '');
  return code;
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
  // London and 3-digit UK area codes: 020 xxxx xxxx, 023 xxxx xxxx, 024, 028, 029
  if (formatted.startsWith('02') && formatted.length === 11) {
    return `${formatted.slice(0, 3)} ${formatted.slice(3, 7)} ${formatted.slice(7)}`;
  }
  // 5-digit area codes: e.g. 01925 (Warrington)
  if (formatted.startsWith('01925') && formatted.length === 11) {
    return `${formatted.slice(0, 5)} ${formatted.slice(5)}`;
  }
  // Standard 4-digit UK area codes: 0151 xxx xxxx, 0161 xxx xxxx, 0121 xxx xxxx, 0113 xxx xxxx
  if (formatted.length === 11) {
    return `${formatted.slice(0, 4)} ${formatted.slice(4, 7)} ${formatted.slice(7)}`;
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
    const cleanCode = !isMobile && area_code ? sanitizeUkAreaCode(area_code) : '';

    if (isMobile) {
      console.log(`[Telephony Search] Searching mobile numbers for country ${country}...`);
      available = await client.availablePhoneNumbers(country).mobile.list({ limit: 12 });
    } else if (cleanCode) {
      // In Twilio for GB (UK), areaCode is not supported because it is NANPA-specific.
      // Searching UK geographic numbers requires using the 'contains' pattern '+44<cleanCode>*'
      const searchPattern = `+44${cleanCode}*`;
      console.log(`[Telephony Search] Searching local numbers matching pattern ${searchPattern} for country ${country}...`);
      
      const rawList = await client.availablePhoneNumbers(country).local.list({
        contains: searchPattern,
        limit: 12,
      });

      // Strict enforcement: ALL returned numbers must start with the requested area code (+44 + cleanCode)
      available = (rawList || []).filter((num: any) =>
        num.phoneNumber && num.phoneNumber.startsWith(`+44${cleanCode}`)
      );

      console.log(`[Telephony Search] Found ${available.length} verified matching numbers for pattern ${searchPattern}`);
      // NOTE: We NEVER fall back to random UK local numbers when the user asked for a specific code!
    } else {
      // General UK local numbers when no specific area code is requested
      console.log(`[Telephony Search] Searching general local numbers for country ${country}...`);
      available = await client.availablePhoneNumbers(country).local.list({ limit: 12 });
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
      cleanCode: cleanCode || null,
      message: cleanCode && numbers.length === 0
        ? `No phone numbers are currently available for area code ${area_code}. Please try another area code.`
        : undefined,
    });
  } catch (error: any) {
    console.error('[Telephony Search API] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to search available numbers' }, { status: 500 });
  }
}
