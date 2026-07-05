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

    // We only want services from tenants that have RwG enabled and are not using external booking
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('is_rwg_enabled', true)
      .neq('booking_mode', 'external_platform');

    if (tenantError) {
      console.error('[RwG Services Feed] DB error fetching tenants:', tenantError);
      return NextResponse.json({ error: 'Internal database error' }, { status: 500 });
    }

    const tenantIds = tenants.map(t => t.id);
    if (tenantIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data: services, error: serviceError } = await supabase
      .from('services')
      .select('id, tenant_id, name, price')
      .in('tenant_id', tenantIds);

    if (serviceError) {
      console.error('[RwG Services Feed] DB error fetching services:', serviceError);
      return NextResponse.json({ error: 'Internal database error' }, { status: 500 });
    }

    const servicesFeed = services.map((service) => {
      // Calculate price_micros: actual price * 1,000,000
      // e.g. 45.00 * 1000000 = 45000000
      const priceMicros = Math.round((Number(service.price) || 0) * 1000000);

      return {
        service: {
          id: service.id,
          merchant_id: service.tenant_id,
          name: service.name,
          description: service.name, // Fallback since DB doesn't have description
          price: {
            price_micros: priceMicros,
            currency_code: 'GBP' // Defaulting to GBP for Styleflo
          },
          price_interpretation: 'EXACT_AMOUNT'
        }
      };
    });

    return NextResponse.json(servicesFeed);
  } catch (error) {
    console.error('[RwG Services Feed] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
