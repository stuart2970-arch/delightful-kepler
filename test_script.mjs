import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  // Try inserting a service with assigned_staff
  const { data: tenants } = await supabase.from('tenants').select('id').limit(1);
  if (!tenants || tenants.length === 0) { console.log('no tenants'); return; }
  const tenant_id = tenants[0].id;
  
  const { data: staff } = await supabase.from('staff').select('id').eq('tenant_id', tenant_id).limit(1);
  const staff_id = staff && staff.length > 0 ? staff[0].id : null;
  
  if (!staff_id) { console.log('no staff'); return; }
  
  const { data, error } = await supabase.from('services').insert({
    tenant_id,
    name: 'Test Service',
    description: 'test description',
    duration_minutes: 60,
    buffer_minutes: 0,
    price: 10
  }).select().single();
  
  if (error) { console.log('Error creating service:', error); return; }
  
  console.log('Service created:', data.id);
  
  const { error: mappingError } = await supabase.from('staff_services').insert([{
    tenant_id,
    service_id: data.id,
    staff_id,
    custom_price: null,
    custom_duration: null
  }]);
  
  if (mappingError) { console.log('Error creating mapping:', mappingError); return; }
  
  console.log('Mapping created successfully');
  
  const { data: fullData, error: fetchError } = await supabase
    .from('services')
    .select('*, staff_services(*)')
    .eq('id', data.id)
    .single();
    
  if (fetchError) { console.log('Error fetching full data:', fetchError); return; }
  console.log('Full data:', fullData);
})();
