const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required to seed demo tenants');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const DEMO_TENANTS = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    company_name: 'Luxe Locks Hair Lounge',
    domain: 'luxelocks.styleflo.ai',
    business_address: '142 Bold Street',
    postcode: 'L1 4JA',
    trading_address_city: 'Liverpool',
    plan_tier: 'ultimate',
    is_active: true,
    booking_mode: 'multi_calendar',
    general_operating_hours: {
      monday: { closed: true, open: '09:00', close: '18:00' },
      tuesday: { closed: false, open: '09:00', close: '18:00' },
      wednesday: { closed: false, open: '09:00', close: '19:00' },
      thursday: { closed: false, open: '09:00', close: '20:00' },
      friday: { closed: false, open: '09:00', close: '19:00' },
      saturday: { closed: false, open: '08:30', close: '17:30' },
      sunday: { closed: true, open: '10:00', close: '16:00' }
    },
    chatbot: {
      id: 'c0000000-0000-0000-0000-000000000001',
      name: 'Luxe Locks AI Stylist Concierge',
      primary_color: '#9333ea',
      voice_enabled: true,
    },
    staff: [
      {
        id: 'e0000000-0000-0000-0000-000000000001',
        name: 'Sarah Miller',
        email: 'demo+sarah@styleflo.ai',
        role: 'Senior Stylist & Creative Director',
        specialist_product: 'Balayage, Precision Cutting, Bridal Styling',
        bio: 'Over 12 years of experience in luxury London and Liverpool salons, specializing in seamless blonde balayage and corrective colouring.'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000002',
        name: 'David Evans',
        email: 'demo+david@styleflo.ai',
        role: 'Master Colorist & Stylist',
        specialist_product: 'Vibrant Colors, Glossing, Olaplex Restorative',
        bio: 'Color specialist passionate about hair health, dimensional brunettes, and gloss transformations.'
      }
    ],
    services: [
      { name: 'Cut & Signature Blow Dry', duration_minutes: 60, price: 55, description: 'Consultation, luxury wash, precision cut, and signature volume blow dry.' },
      { name: 'Bespoke Balayage & Gloss', duration_minutes: 150, price: 145, description: 'Hand-painted dimensional color with custom toner/gloss and bonding treatment.' },
      { name: 'Full Head Foil Highlights', duration_minutes: 120, price: 120, description: 'Classic foil work for maximum brightness and seamless lift.' },
      { name: 'Olaplex Rebuilding Treatment', duration_minutes: 30, price: 35, description: 'Deep molecular bond rebuilding for damaged or chemically processed hair.' }
    ]
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    company_name: 'Pure Glow Aesthetics Clinic',
    domain: 'pureglow.styleflo.ai',
    business_address: '88 Rodney Street',
    postcode: 'L1 9AR',
    trading_address_city: 'Liverpool',
    plan_tier: 'ultimate',
    is_active: true,
    booking_mode: 'multi_calendar',
    general_operating_hours: {
      monday: { closed: false, open: '09:30', close: '18:00' },
      tuesday: { closed: false, open: '09:30', close: '18:00' },
      wednesday: { closed: false, open: '09:30', close: '19:30' },
      thursday: { closed: false, open: '09:30', close: '19:30' },
      friday: { closed: false, open: '09:30', close: '18:00' },
      saturday: { closed: false, open: '09:00', close: '16:00' },
      sunday: { closed: true, open: '10:00', close: '16:00' }
    },
    chatbot: {
      id: 'c0000000-0000-0000-0000-000000000002',
      name: 'Pure Glow Clinical AI Advisor',
      primary_color: '#0d9488',
      voice_enabled: true,
    },
    staff: [
      {
        id: 'e0000000-0000-0000-0000-000000000003',
        name: 'Dr. Emily Hayes',
        email: 'demo+emily@styleflo.ai',
        role: 'Lead Aesthetic Doctor (MBChB, GMC)',
        specialist_product: 'Anti-Wrinkle, Dermal Fillers, Profhilo Skin Boosters',
        bio: 'Medical doctor with 10 years experience in clinical facial rejuvenation, subtle natural enhancement, and medical skincare.'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000004',
        name: 'Chloe Morgan',
        email: 'demo+chloe@styleflo.ai',
        role: 'Senior Medical Skin Specialist',
        specialist_product: 'Hydrafacial, Chemical Peels, Microneedling',
        bio: 'Specialist in advanced skin barrier restoration, hyperpigmentation correction, and clinical facial therapies.'
      }
    ],
    services: [
      { name: 'Anti-Wrinkle Treatment (3 Areas)', duration_minutes: 45, price: 195, description: 'Medical consultation followed by targeted wrinkle relaxing treatment.' },
      { name: 'Profhilo Bioremodeling Treatment', duration_minutes: 45, price: 250, description: 'Ultra-pure hyaluronic acid skin booster for intense hydration and firmness.' },
      { name: 'Medical Hydrafacial Deluxe', duration_minutes: 60, price: 115, description: 'Deep cleansing, gentle exfoliating peel, extraction, and antioxidant hydration.' },
      { name: 'BioRePeel Medical Grade Chemical Peel', duration_minutes: 45, price: 90, description: 'No-downtime TCA peel stimulating cellular renewal and collagen.' }
    ]
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    company_name: 'The Grooming Room Barbers',
    domain: 'groomingroom.styleflo.ai',
    business_address: '24 Castle Street',
    postcode: 'L2 0NR',
    trading_address_city: 'Liverpool',
    plan_tier: 'ultimate',
    is_active: true,
    booking_mode: 'multi_calendar',
    general_operating_hours: {
      monday: { closed: false, open: '08:30', close: '18:00' },
      tuesday: { closed: false, open: '08:30', close: '18:00' },
      wednesday: { closed: false, open: '08:30', close: '18:00' },
      thursday: { closed: false, open: '08:30', close: '19:30' },
      friday: { closed: false, open: '08:30', close: '19:30' },
      saturday: { closed: false, open: '08:00', close: '17:00' },
      sunday: { closed: false, open: '10:00', close: '16:00' }
    },
    chatbot: {
      id: 'c0000000-0000-0000-0000-000000000003',
      name: 'Grooming Room Barber Concierge',
      primary_color: '#b45309',
      voice_enabled: true,
    },
    staff: [
      {
        id: 'e0000000-0000-0000-0000-000000000005',
        name: 'Marcus Vance',
        email: 'demo+marcus@styleflo.ai',
        role: 'Master Barber & Founder',
        specialist_product: 'Skin Fades, Scissor Over Comb, Hot Towel Shaving',
        bio: 'Award-winning traditional barber blending classic British barbering with modern razor work.'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000006',
        name: 'Liam Cooper',
        email: 'demo+liam@styleflo.ai',
        role: 'Senior Barber & Beard Stylist',
        specialist_product: 'Beard Sculpting, Taper Fades, Texture Crops',
        bio: 'Precision fade specialist and master beard sculptor with an eye for clean profiles.'
      }
    ],
    services: [
      { name: 'Executive Haircut & Beard Sculpt', duration_minutes: 50, price: 38, description: 'Full precision fade or scissor cut with razor-sharp beard shaping and hot towel finish.' },
      { name: 'Traditional Luxury Hot Towel Shave', duration_minutes: 40, price: 28, description: 'Pre-shave essential oils, double hot towels, straight razor cut, and cooling balm.' },
      { name: 'Precision Skin Fade & Style', duration_minutes: 35, price: 26, description: 'Seamless skin-to-length fade with wash and matte clay styling.' },
      { name: 'Beard Trim & Steam Treatment', duration_minutes: 25, price: 18, description: 'Shaping, line-up with trimmer/foil, and conditioning beard butter application.' }
    ]
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    company_name: 'Velvet Nail & Day Spa',
    domain: 'velvetspa.styleflo.ai',
    business_address: '12 Hope Street',
    postcode: 'L1 9BW',
    trading_address_city: 'Liverpool',
    plan_tier: 'ultimate',
    is_active: true,
    booking_mode: 'multi_calendar',
    general_operating_hours: {
      monday: { closed: true, open: '10:00', close: '18:00' },
      tuesday: { closed: false, open: '10:00', close: '18:00' },
      wednesday: { closed: false, open: '10:00', close: '19:00' },
      thursday: { closed: false, open: '10:00', close: '20:00' },
      friday: { closed: false, open: '10:00', close: '20:00' },
      saturday: { closed: false, open: '09:00', close: '18:00' },
      sunday: { closed: false, open: '10:00', close: '17:00' }
    },
    chatbot: {
      id: 'c0000000-0000-0000-0000-000000000004',
      name: 'Velvet Spa Wellness Assistant',
      primary_color: '#db2777',
      voice_enabled: true,
    },
    staff: [
      {
        id: 'e0000000-0000-0000-0000-000000000007',
        name: 'Sophie Bennett',
        email: 'demo+sophie@styleflo.ai',
        role: 'Spa Director & Nail Artist',
        specialist_product: 'BIAB Nails, Russian Manicure, Nail Art',
        bio: 'Dedicated nail health specialist specializing in builder gel overlays and intricate minimalist nail art.'
      },
      {
        id: 'e0000000-0000-0000-0000-000000000008',
        name: 'Maya Patel',
        email: 'demo+maya@styleflo.ai',
        role: 'Holistic Massage & Body Therapist',
        specialist_product: 'Deep Tissue, Hot Stone Therapy, Indian Head Massage',
        bio: 'Holistic therapist with over 8 years in 5-star spa environments focusing on stress relief and muscular release.'
      }
    ],
    services: [
      { name: 'Deep Tissue Full Body Massage (60m)', duration_minutes: 60, price: 70, description: 'Targeted pressure therapy releasing deep muscle tension and chronic aches.' },
      { name: 'BIAB Builder Gel Manicure with Art', duration_minutes: 60, price: 44, description: 'Cuticle preparation, builder gel reinforcement for natural nail growth, and accent nail art.' },
      { name: 'Luxury Rose Quartz Spa Pedicure', duration_minutes: 60, price: 50, description: 'Aromatic foot soak, exfoliating scrub, heel buffing, massage, and long-lasting gel polish.' },
      { name: 'Radiance Aromatherapy Facial & Scalp', duration_minutes: 60, price: 65, description: 'Botanical cleanse, lymphatic drainage facial massage, mask, and tension-relief scalp treatment.' }
    ]
  }
];

async function seed() {
  console.log('Seeding 4 Demo Industry Tenants...');

  for (const tenantData of DEMO_TENANTS) {
    const { chatbot, staff, services, ...tenantFields } = tenantData;

    // 1. Upsert Tenant
    const { error: tErr } = await supabase
      .from('tenants')
      .upsert(tenantFields, { onConflict: 'id' });

    if (tErr) {
      console.error(`Failed to upsert tenant ${tenantFields.company_name}:`, tErr.message);
      continue;
    }
    console.log(`✓ Tenant ready: ${tenantFields.company_name} (${tenantFields.id})`);

    // 2. Upsert Chatbot
    const { error: cbErr } = await supabase
      .from('chatbots')
      .upsert({
        id: chatbot.id,
        tenant_id: tenantFields.id,
        name: chatbot.name,
        primary_color: chatbot.primary_color,
        voice_enabled: chatbot.voice_enabled,
      }, { onConflict: 'id' });

    if (cbErr) {
      console.error(`Failed to upsert chatbot for ${tenantFields.company_name}:`, cbErr.message);
    } else {
      console.log(`  ✓ Chatbot ready: ${chatbot.name}`);
    }

    // 3. Upsert Staff
    for (const member of staff) {
      const { error: stErr } = await supabase
        .from('staff')
        .upsert({
          id: member.id,
          tenant_id: tenantFields.id,
          name: member.name,
          email: member.email,
          role: member.role,
          specialist_product: member.specialist_product,
          bio: member.bio,
          working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          chatbot_id: chatbot.id
        }, { onConflict: 'id' });

      if (stErr) {
        console.error(`  Failed to upsert staff ${member.name}:`, stErr.message);
      } else {
        console.log(`  ✓ Staff member ready: ${member.name} (${member.role})`);
      }
    }

    // 4. Upsert Services
    for (const s of services) {
      const { error: sErr } = await supabase
        .from('services')
        .upsert({
          tenant_id: tenantFields.id,
          name: s.name,
          duration_minutes: s.duration_minutes,
          buffer_minutes: 10,
          price: s.price,
          description: s.description,
          chatbot_id: chatbot.id
        }, { onConflict: 'tenant_id, name' });

      if (sErr) {
        // Fallback: check if service exists
        const { data: existing } = await supabase
          .from('services')
          .select('id')
          .eq('tenant_id', tenantFields.id)
          .eq('name', s.name)
          .maybeSingle();

        if (!existing) {
          await supabase.from('services').insert({
            tenant_id: tenantFields.id,
            name: s.name,
            duration_minutes: s.duration_minutes,
            buffer_minutes: 10,
            price: s.price,
            description: s.description,
            chatbot_id: chatbot.id
          });
        }
      }
      console.log(`  ✓ Service ready: ${s.name} (£${s.price})`);
    }
  }

  console.log('\nAll 4 Demo Industry Tenants seeded successfully!');
}

seed().catch(err => {
  console.error('Fatal seeding error:', err);
  process.exit(1);
});
