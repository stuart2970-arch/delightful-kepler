import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Helper function to safely initialize Supabase Admin Client (preventing build-time failures when keys are absent)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';
  return createClient(supabaseUrl, serviceRoleKey);
}

async function fetchGoogleReviews(tenant: any, apiKey: string): Promise<any[]> {
  try {
    const addressParts = [
      tenant.rwg_business_name || tenant.company_name,
      tenant.trading_address_street || tenant.business_address,
      tenant.trading_address_city,
      tenant.trading_address_postcode || tenant.postcode
    ].filter(Boolean);

    if (addressParts.length === 0) return [];
    const query = addressParts.join(', ');

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.reviews',
        'Referer': 'https://app.styleflo.ai/'
      },
      body: JSON.stringify({
        textQuery: query
      })
    });

    if (!response.ok) {
      console.warn('[Places API Error]', response.status, await response.text());
      return [];
    }

    const data = await response.json();
    const place = data.places?.[0];
    
    if (place && place.reviews && Array.isArray(place.reviews)) {
      return place.reviews.map((r: any) => ({
        rating: r.rating || 5,
        text: r.text?.text || r.originalText?.text || '',
        author_name: r.authorAttribution?.displayName || 'Anonymous'
      }));
    }
    return [];
  } catch (error) {
    console.error('Error fetching Google Reviews:', error);
    return [];
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0, must-revalidate'
};

/**
 * Real-Time Shift Status Calculator Engine
 * Evaluates AM/PM schedules against the current local date and time.
 * Supports both database formats: { am_start, am_finish } and { am: { start, end } }.
 */
function calculateStaffStatus(workingDays: any[]): 'on-shift' | 'on-break' | 'off-duty' {
  if (!workingDays || !Array.isArray(workingDays)) return 'off-duty';

  const now = new Date();
  // Adjust to local timezone string (e.g., Europe/London for UK GDPR salons)
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', timeZone: 'Europe/London' };
  const currentDay = new Intl.DateTimeFormat('en-US', options).format(now).toLowerCase();

  // Format current HH:MM
  const currentHHMM = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });

  // Find active schedule block matching current weekday
  const todaySchedule = workingDays.find(
    (d: any) => d.day?.toLowerCase() === currentDay && !d.unavailable
  );

  if (!todaySchedule) return 'off-duty';

  // Support both snake_case flat format and nested object format
  const am_start = todaySchedule.am_start || todaySchedule.am?.start;
  const am_finish = todaySchedule.am_finish || todaySchedule.am?.end;
  const pm_start = todaySchedule.pm_start || todaySchedule.pm?.start;
  const pm_finish = todaySchedule.pm_finish || todaySchedule.pm?.end;

  // 1. Evaluate AM Shift boundaries
  if (am_start && am_finish && currentHHMM >= am_start && currentHHMM <= am_finish) {
    return 'on-shift';
  }

  // 2. Evaluate Afternoon Break gap
  if (am_finish && pm_start && currentHHMM > am_finish && currentHHMM < pm_start) {
    return 'on-break';
  }

  // 3. Evaluate PM Shift boundaries
  if (pm_start && pm_finish && currentHHMM >= pm_start && currentHHMM <= pm_finish) {
    return 'on-shift';
  }

  return 'off-duty';
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!slug) {
    return NextResponse.json({ success: false, error: 'Missing tenant identifier slug' }, { status: 400, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    // 1. Resolve Tenant profile & active chatbot settings
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select(`
        id,
        company_name,
        business_address,
        postcode,
        general_operating_hours,
        google_maps_share_url,
        google_reviews,
        latitude,
        longitude,
        trading_address_street,
        trading_address_city,
        trading_address_postcode,
        trading_address_phone,
        company_registration_number,
        registered_address_street,
        registered_address_city,
        registered_address_postcode,
        is_registered_company,
        registered_address_same_as_trading,
        rwg_address_same_as_trading,
        chatbots (
          id,
          name,
          primary_color
        )
      `)
      .eq('slug', slug)
      .single();

    if (tenantError || !tenant) {
      const errMsg = tenantError ? tenantError.message : 'Tenant profile not found';
      return NextResponse.json({ success: false, error: errMsg }, { status: 404, headers: corsHeaders });
    }

    let googleReviews: any[] = [];
    let cachedReviews: any[] = [];
    let lastUpdated: string | null = null;

    if (tenant.google_reviews) {
      if (Array.isArray(tenant.google_reviews)) {
        cachedReviews = tenant.google_reviews;
      } else if (typeof tenant.google_reviews === 'object' && tenant.google_reviews !== null) {
        cachedReviews = (tenant.google_reviews as any).reviews || [];
        lastUpdated = (tenant.google_reviews as any).last_updated || null;
      }
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    const isCacheExpired = !lastUpdated || (Date.now() - new Date(lastUpdated).getTime() > 24 * 60 * 60 * 1000);

    if (apiKey && (cachedReviews.length === 0 || isCacheExpired)) {
      try {
        const freshReviews = await fetchGoogleReviews(tenant, apiKey);
        if (freshReviews && freshReviews.length > 0) {
          googleReviews = freshReviews;
          // Save to database asynchronously to keep response fast
          supabaseAdmin
            .from('tenants')
            .update({
              google_reviews: {
                last_updated: new Date().toISOString(),
                reviews: freshReviews
              }
            })
            .eq('id', tenant.id)
            .then(({ error }) => {
              if (error) console.error('Failed to update tenant reviews in DB:', error);
            });
        } else {
          googleReviews = cachedReviews;
        }
      } catch (err) {
        console.error('Failed fetching reviews on page load:', err);
        googleReviews = cachedReviews;
      }
    } else {
      googleReviews = cachedReviews;
    }

    const activeBot = tenant.chatbots?.[0];
    let staffList: any[] = [];
    let servicesList: any[] = [];

    // 2. Fetch associated staff roster and services
    if (activeBot) {
      const [{ data: staff }, { data: services }] = await Promise.all([
        supabaseAdmin.from('staff').select('id, name, role, email, working_days').eq('chatbot_id', activeBot.id),
        supabaseAdmin.from('services').select('id, name, description, duration_minutes, price').eq('chatbot_id', activeBot.id).order('created_at', { ascending: true })
      ]);

      if (staff) {
        // 3. Inject computed on-shift/break/off-duty statuses
        staffList = staff.map((member: any) => ({
          id: member.id,
          name: member.name,
          role: member.role || 'Specialist',
          email: member.email,
          status: calculateStaffStatus(member.working_days)
        }));
      }

      if (services) {
        servicesList = services.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          duration_minutes: s.duration_minutes || 60,
          price: s.price || 0
        }));
      }
    }

    // 4. Return dynamic payload with CORS allowances for cross-domain WordPress AJAX
    return NextResponse.json(
      {
        company_name: tenant.company_name,
        business_address: tenant.trading_address_street || tenant.business_address || '',
        postcode: tenant.trading_address_postcode || tenant.postcode || '',
        trading_address_street: tenant.trading_address_street || '',
        trading_address_city: tenant.trading_address_city || '',
        trading_address_postcode: tenant.trading_address_postcode || '',
        trading_address_phone: tenant.trading_address_phone || '',
        company_registration_number: tenant.company_registration_number || '',
        is_registered_company: tenant.is_registered_company || false,
        registered_address_street: tenant.registered_address_street || '',
        registered_address_city: tenant.registered_address_city || '',
        registered_address_postcode: tenant.registered_address_postcode || '',
        general_operating_hours: tenant.general_operating_hours,
        google_maps_share_url: tenant.google_maps_share_url,
        google_reviews: googleReviews,
        latitude: tenant.latitude,
        longitude: tenant.longitude,
        primary_color: activeBot?.primary_color || '#7E5FBB',
        chatbot_id: activeBot?.id || null,
        staff: staffList,
        services: servicesList
      },
      {
        status: 200,
        headers: corsHeaders
      }
    );

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
  }
}

// Support browser Preflight CORS requests seamlessly
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
