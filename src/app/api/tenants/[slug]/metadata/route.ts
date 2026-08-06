import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin Client to bypass RLS for dynamic public requests
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const activeBot = tenant.chatbots?.[0];
    let staffList: any[] = [];

    // 2. Fetch associated staff roster
    if (activeBot) {
      const { data: staff, error: staffError } = await supabaseAdmin
        .from('staff')
        .select('id, name, role, email, working_days')
        .eq('chatbot_id', activeBot.id);

      if (!staffError && staff) {
        // 3. Inject computed on-shift/break/off-duty statuses
        staffList = staff.map((member: any) => ({
          id: member.id,
          name: member.name,
          role: member.role || 'Specialist',
          email: member.email,
          status: calculateStaffStatus(member.working_days)
        }));
      }
    }

    // 4. Return dynamic payload with CORS allowances for cross-domain WordPress AJAX
    return NextResponse.json(
      {
        company_name: tenant.company_name,
        business_address: tenant.business_address,
        postcode: tenant.postcode,
        general_operating_hours: tenant.general_operating_hours,
        google_maps_share_url: tenant.google_maps_share_url,
        google_reviews: tenant.google_reviews,
        latitude: tenant.latitude,
        longitude: tenant.longitude,
        primary_color: activeBot?.primary_color || '#7E5FBB',
        chatbot_id: activeBot?.id || null,
        staff: staffList
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
