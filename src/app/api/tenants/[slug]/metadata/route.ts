import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Helper function to safely initialize Supabase Admin Client (preventing build-time failures when keys are absent)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';
  return createClient(supabaseUrl, serviceRoleKey);
}

function parseGoogleOpeningHours(googleHours: any) {
  const daysMap: Record<number, string> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday'
  };

  const hoursResult: Record<string, any> = {};

  // Initialize all days as closed
  Object.values(daysMap).forEach(day => {
    hoursResult[day] = {
      hours: { start: '09:00', end: '17:00' },
      unavailable: true
    };
  });

  if (!googleHours || !Array.isArray(googleHours.periods)) {
    return hoursResult;
  }

  const pad = (num: number) => String(num).padStart(2, '0');

  for (const period of googleHours.periods) {
    const dayNum = period.open?.day;
    if (dayNum === undefined) continue;

    const dayName = daysMap[dayNum];
    if (!dayName) continue;

    const startHour = period.open?.hour;
    const startMin = period.open?.minute;
    const endHour = period.close?.hour;
    const endMin = period.close?.minute;

    if (startHour !== undefined && startMin !== undefined && endHour !== undefined && endMin !== undefined) {
      hoursResult[dayName] = {
        hours: {
          start: `${pad(startHour)}:${pad(startMin)}`,
          end: `${pad(endHour)}:${pad(endMin)}`
        },
        unavailable: false
      };
    }
  }

  return hoursResult;
}

async function fetchGoogleReviews(tenant: any, apiKey: string): Promise<{ rating: number; userRatingCount: number; placeId: string; reviews: any[]; regularOpeningHours: any; photos: string[] }> {
  const defaultResult = { rating: 5, userRatingCount: 0, placeId: '', reviews: [], regularOpeningHours: null, photos: [] };
  try {
    const addressParts = [
      tenant.rwg_business_name || tenant.company_name,
      tenant.trading_address_street || tenant.business_address,
      tenant.trading_address_city,
      tenant.trading_address_postcode || tenant.postcode
    ].filter(Boolean);

    if (addressParts.length === 0) return defaultResult;
    const query = addressParts.join(', ');

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.reviews,places.regularOpeningHours,places.photos',
        'Referer': 'https://app.styleflo.ai/'
      },
      body: JSON.stringify({
        textQuery: query
      })
    });

    if (!response.ok) {
      console.warn('[Places API Error]', response.status, await response.text());
      return defaultResult;
    }

    const data = await response.json();
    const place = data.places?.[0];
    
    if (place) {
      const reviews = Array.isArray(place.reviews) ? place.reviews.map((r: any) => ({
        rating: r.rating || 5,
        text: r.text?.text || r.originalText?.text || '',
        author_name: r.authorAttribution?.displayName || 'Anonymous'
      })) : [];

      const parsedHours = place.regularOpeningHours ? parseGoogleOpeningHours(place.regularOpeningHours) : null;

      // Filter and prioritize owner-uploaded photos (displayName matches company_name or rwg_business_name)
      const businessNameLower = (tenant.rwg_business_name || tenant.company_name || '').toLowerCase();
      const placePhotos = place.photos || [];
      
      const ownerPhotos = placePhotos.filter((p: any) => {
        const creatorName = p.authorAttributions?.[0]?.displayName || '';
        return creatorName.toLowerCase().includes(businessNameLower);
      });

      const customerPhotos = placePhotos.filter((p: any) => {
        const creatorName = p.authorAttributions?.[0]?.displayName || '';
        return !creatorName.toLowerCase().includes(businessNameLower);
      });

      // Combine prioritizing owner photos up to 10
      const combinedPhotos = [...ownerPhotos, ...customerPhotos].slice(0, 10);

      const photoPromises = combinedPhotos.map(async (photo: any) => {
        try {
          const mediaRes = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?key=${apiKey}&maxWidthPx=1920&skipHttpRedirect=true`, {
            headers: { 'Referer': 'https://app.styleflo.ai/' }
          });
          if (mediaRes.ok) {
            const mediaData = await mediaRes.json();
            return mediaData.photoUri || null;
          }
        } catch (e) {
          console.error('Error fetching media URI for photo:', photo.name, e);
        }
        return null;
      });

      const photosList = (await Promise.all(photoPromises)).filter(Boolean) as string[];

      return {
        rating: place.rating || 5,
        userRatingCount: place.userRatingCount || 0,
        placeId: place.id || '',
        reviews,
        regularOpeningHours: parsedHours,
        photos: photosList
      };
    }
    return defaultResult;
  } catch (error) {
    console.error('Error fetching Google Reviews:', error);
    return defaultResult;
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

function getMondayDate(inputDate?: Date | string): string {
  const d = inputDate ? new Date(typeof inputDate === 'string' && !inputDate.includes('T') ? inputDate + 'T00:00:00' : inputDate) : new Date();
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    const day = fallback.getDay();
    const diff = fallback.getDate() - day + (day === 0 ? -6 : 1);
    fallback.setDate(diff);
    return fallback.toISOString().split('T')[0];
  }
  
  const day = d.getDay(); // 0 is Sunday, 1 is Monday, ...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dateNum = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateNum}`;
}

/**
 * Real-Time Shift Status Calculator Engine
 * Evaluates AM/PM schedules against current local date and time in Europe/London (UK timezone).
 * Supports rolling weekly schedules { weeks: [...] }, flat array schedules, and flat day maps.
 */
function calculateStaffStatus(workingDays: any): 'on-shift' | 'on-break' | 'off-duty' {
  if (!workingDays) return 'off-duty';

  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', timeZone: 'Europe/London' };
  const currentDay = new Intl.DateTimeFormat('en-US', options).format(now).toLowerCase();

  // Format current HH:MM in Europe/London (24hr format)
  const currentHHMM = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });

  let todaySchedule: any = null;

  // Case 1: Rolling weekly schedule object { weeks: [ { weekCommencingDate, monday, tuesday, ... } ] }
  if (workingDays && Array.isArray(workingDays.weeks) && workingDays.weeks.length > 0) {
    const todayMonday = getMondayDate(now);
    let matchedWeek = workingDays.weeks.find((w: any) => w && w.weekCommencingDate === todayMonday);
    if (!matchedWeek) {
      matchedWeek = workingDays.weeks[0];
    }
    if (matchedWeek && matchedWeek[currentDay]) {
      todaySchedule = matchedWeek[currentDay];
    }
  } 
  // Case 2: Array of days [{ day: 'monday', am, pm, unavailable }, ...]
  else if (Array.isArray(workingDays)) {
    todaySchedule = workingDays.find(
      (d: any) => d && (d.day?.toLowerCase() === currentDay || d.name?.toLowerCase() === currentDay)
    );
  } 
  // Case 3: Flat day object { monday: { am, pm, unavailable }, ... }
  else if (typeof workingDays === 'object') {
    if (workingDays[currentDay]) {
      todaySchedule = workingDays[currentDay];
    }
  }

  // If marked explicitly unavailable or holiday
  if (todaySchedule && todaySchedule.unavailable) {
    return 'off-duty';
  }

  // Extract AM / PM shift times
  let am_start = todaySchedule?.am_start || todaySchedule?.am?.start;
  let am_finish = todaySchedule?.am_finish || todaySchedule?.am?.end;
  let pm_start = todaySchedule?.pm_start || todaySchedule?.pm?.start;
  let pm_finish = todaySchedule?.pm_finish || todaySchedule?.pm?.end;

  // Fallback defaults if weekday (Mon-Sat) and not explicitly marked unavailable
  if (!am_start && !pm_start && currentDay !== 'sunday') {
    am_start = '09:00';
    am_finish = '13:00';
    pm_start = '14:00';
    pm_finish = '18:00';
  }

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
          primary_color,
          configuration_json
        )
      `)
      .eq('slug', slug)
      .single();

    if (tenantError || !tenant) {
      const errMsg = tenantError ? tenantError.message : 'Tenant profile not found';
      return NextResponse.json({ success: false, error: errMsg }, { status: 404, headers: corsHeaders });
    }

    let googleReviews: any[] = [];
    let googleRating = 5;
    let googleRatingCount = 0;
    let googleWriteReviewUrl = '';
    let googlePhotos: string[] = [];
    let generalHours = tenant.general_operating_hours;
    
    let cachedReviews: any[] = [];
    let lastUpdated: string | null = null;

    if (tenant.google_reviews) {
      if (Array.isArray(tenant.google_reviews)) {
        cachedReviews = tenant.google_reviews;
      } else if (typeof tenant.google_reviews === 'object' && tenant.google_reviews !== null) {
        cachedReviews = (tenant.google_reviews as any).reviews || [];
        lastUpdated = (tenant.google_reviews as any).last_updated || null;
        googleRating = (tenant.google_reviews as any).rating || 5;
        googleRatingCount = (tenant.google_reviews as any).userRatingCount || 0;
        googlePhotos = (tenant.google_reviews as any).photos || [];
        if ((tenant.google_reviews as any).placeId) {
          googleWriteReviewUrl = `https://search.google.com/local/writereview?placeid=${(tenant.google_reviews as any).placeId}`;
        }
      }
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    const isCacheExpired = !lastUpdated || (Date.now() - new Date(lastUpdated).getTime() > 24 * 60 * 60 * 1000);

    if (apiKey && (cachedReviews.length === 0 || isCacheExpired)) {
      try {
        const result = await fetchGoogleReviews(tenant, apiKey);
        googleReviews = result.reviews;
        googleRating = result.rating;
        googleRatingCount = result.userRatingCount;
        googlePhotos = result.photos;
        if (result.placeId) {
          googleWriteReviewUrl = `https://search.google.com/local/writereview?placeid=${result.placeId}`;
        }
        if (result.regularOpeningHours) {
          generalHours = result.regularOpeningHours;
        }

        // Save to database asynchronously to keep response fast
        const updateData: any = {
          google_reviews: {
            last_updated: new Date().toISOString(),
            rating: result.rating,
            userRatingCount: result.userRatingCount,
            placeId: result.placeId,
            reviews: result.reviews,
            photos: result.photos
          }
        };
        if (result.regularOpeningHours) {
          updateData.general_operating_hours = result.regularOpeningHours;
        }

        supabaseAdmin
          .from('tenants')
          .update(updateData)
          .eq('id', tenant.id)
          .then(({ error }) => {
            if (error) console.error('Failed to update tenant reviews/hours in DB:', error);
          });
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
        supabaseAdmin.from('staff').select('id, name, role, email, working_days, image_url, specialist_product, bio').eq('chatbot_id', activeBot.id),
        supabaseAdmin.from('services').select('id, name, description, duration_minutes, price').eq('chatbot_id', activeBot.id).order('created_at', { ascending: true })
      ]);

      if (staff) {
        // 3. Inject computed on-shift/break/off-duty statuses
        staffList = staff.map((member: any) => {
          const rawRole = (member.role || '').trim();
          const cleanRole = rawRole.toLowerCase() === 'specialist' ? '' : rawRole;
          return {
            id: member.id,
            name: member.name,
            role: cleanRole,
            email: member.email,
            status: calculateStaffStatus(member.working_days),
            image_url: member.image_url,
            specialist_product: member.specialist_product,
            bio: member.bio
          };
        });
      }

      if (services) {
        servicesList = services.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          duration_minutes: s.duration_minutes || 60,
          price: s.price || 0
        }));

        // Sort services according to ordered_service_ids if present in chatbot configuration_json
        const config = activeBot.configuration_json as Record<string, any> || {};
        const orderedServiceIds = config.ordered_service_ids || [];
        if (Array.isArray(orderedServiceIds) && orderedServiceIds.length > 0) {
          servicesList.sort((a, b) => {
            const indexA = orderedServiceIds.indexOf(a.id);
            const indexB = orderedServiceIds.indexOf(b.id);
            
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
          });
        }
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
        general_operating_hours: generalHours,
        google_maps_share_url: tenant.google_maps_share_url,
        google_reviews: googleReviews,
        google_rating: googleRating,
        google_rating_count: googleRatingCount,
        google_write_review_url: googleWriteReviewUrl,
        google_photos: googlePhotos,
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
