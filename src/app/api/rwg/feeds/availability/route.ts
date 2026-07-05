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

    // We only want availability from tenants that have RwG enabled and are not external_platform
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('is_rwg_enabled', true)
      .neq('booking_mode', 'external_platform');

    if (tenantError) return NextResponse.json({ error: 'DB Error' }, { status: 500 });
    const tenantIds = tenants.map(t => t.id);
    if (tenantIds.length === 0) return NextResponse.json([]);

    const { data: staffData } = await supabase.from('staff').select('*').in('tenant_id', tenantIds);
    const { data: servicesData } = await supabase.from('services').select('*').in('tenant_id', tenantIds);
    const { data: appointmentsData } = await supabase.from('appointments')
      .select('*')
      .in('tenant_id', tenantIds)
      .gte('start_time', new Date().toISOString());

    if (!staffData || !servicesData) {
      return NextResponse.json([]);
    }

    const availabilityFeed: any[] = [];
    const now = new Date();
    
    // Generate availability for next 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      targetDate.setHours(0,0,0,0);
      
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const currentDayName = dayNames[targetDate.getDay()];

      for (const tenant of tenants) {
        const tenantStaff = staffData.filter(s => s.tenant_id === tenant.id);
        const tenantServices = servicesData.filter(s => s.tenant_id === tenant.id);
        
        for (const staff of tenantStaff) {
          const workingDays = staff.working_days || {};
          const daySchedule = workingDays[currentDayName];
          if (!daySchedule || daySchedule.unavailable) continue;

          for (const service of tenantServices) {
            // For both AM and PM shifts if configured
            const shifts = [daySchedule.am, daySchedule.pm].filter(Boolean);
            
            for (const shift of shifts) {
              if (!shift.start || !shift.end) continue;
              
              const shiftStart = new Date(targetDate);
              const [startH, startM] = shift.start.split(':').map(Number);
              shiftStart.setHours(startH, startM, 0, 0);
              
              const shiftEnd = new Date(targetDate);
              const [endH, endM] = shift.end.split(':').map(Number);
              shiftEnd.setHours(endH, endM, 0, 0);

              const serviceDurationMs = (service.duration_minutes + (service.buffer_minutes || 0)) * 60000;
              let currentSlotStart = shiftStart.getTime();

              while (currentSlotStart + serviceDurationMs <= shiftEnd.getTime()) {
                const currentSlotEnd = currentSlotStart + serviceDurationMs;
                
                // Check against existing appointments for this staff
                const isBooked = appointmentsData?.some(app => {
                  if (app.staff_id !== staff.id) return false;
                  const appStart = new Date(app.start_time).getTime();
                  const appEnd = new Date(app.end_time).getTime();
                  return (currentSlotStart < appEnd && currentSlotEnd > appStart);
                });

                if (!isBooked && currentSlotStart > Date.now()) {
                  availabilityFeed.push({
                    availability: {
                      merchant_id: tenant.id,
                      service_id: service.id,
                      start_sec: Math.floor(currentSlotStart / 1000),
                      duration_sec: service.duration_minutes * 60,
                      spots_total: 1,
                      spots_open: 1,
                      resources: {
                        staff_id: staff.id,
                        staff_name: staff.name
                      }
                    }
                  });
                }
                
                // Increment slot (e.g. 15 or 30 min intervals, let's just do exact service duration blocks for simplicity, or 30 mins)
                currentSlotStart += 30 * 60000; // 30 min interval
              }
            }
          }
        }
      }
    }

    return NextResponse.json(availabilityFeed);
  } catch (error) {
    console.error('[RwG Availability Feed] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
