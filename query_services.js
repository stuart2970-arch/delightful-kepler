const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://tkoasyjvrgaglofpzduq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrb2FzeWp2cmdhZ2xvZnB6ZHVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU5NTcwNSwiZXhwIjoyMDk3MTcxNzA1fQ.VyWIQX2CFUUsAyDakbIEX805sz35TxHnjcAxBPWxliw';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: services, error } = await supabase
    .from('services')
    .select('*, tenants(company_name, domain)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  
  console.log(JSON.stringify(services, null, 2));
}

run();
