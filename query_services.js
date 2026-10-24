/**
 * Ad-hoc services dump. Requires local/staging env — never hardcodes live credentials (STYL-210).
 * Usage: node -r dotenv/config query_services.js dotenv_config_path=.env.local
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run env:local).');
  process.exit(1);
}

if (/tkoasyjvrgaglofpzduq/i.test(supabaseUrl) && process.env.APP_ENV !== 'production') {
  console.error('Refusing to query the live Supabase project from a local script.');
  process.exit(1);
}

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
