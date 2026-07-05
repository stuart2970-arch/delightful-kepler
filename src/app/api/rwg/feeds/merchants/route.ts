import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env['NEXT_PUBLIC_SUPABASE_URL'] || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    });

    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, company_name, is_rwg_enabled, rwg_business_name, rwg_street_address, rwg_city, rwg_postcode, rwg_phone')
      .eq('is_rwg_enabled', true)
      .neq('booking_mode', 'external_platform');

    if (error) {
      console.error('[RwG Merchants Feed] DB error:', error);
      return NextResponse.json({ error: 'Internal database error' }, { status: 500 });
    }

    const merchantsFeed = tenants.map((tenant) => ({
      merchant: {
        id: tenant.id,
        name: tenant.rwg_business_name || tenant.company_name,
        address: {
          address_line: [tenant.rwg_street_address || ''],
          locality: tenant.rwg_city || '',
          postal_code: tenant.rwg_postcode || '',
          country_country_code: 'GB', // Defaulting to GB as per Styleflo UK market focus, or make dynamic later
        },
        telephone: tenant.rwg_phone || undefined,
        category: 'HAIR_SALON',
      }
    }));

    // Wrap in standard Google Feed format if needed, but for now returning array of merchant objects
    return NextResponse.json(merchantsFeed);
  } catch (error) {
    console.error('[RwG Merchants Feed] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
