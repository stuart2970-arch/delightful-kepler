require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Get a chatbot ID
  const { data: chatbots } = await supabaseAdmin.from('chatbots').select('id, tenant_id').limit(1);
  if (!chatbots || chatbots.length === 0) {
    console.log("No chatbots found.");
    return;
  }
  const bot = chatbots[0];

  // 2. Insert a dummy chunk
  const dummyUrl = 'https://test-delete-url.com/' + Date.now();
  const { error: insertError } = await supabaseAdmin.from('document_chunks').insert({
    tenant_id: bot.tenant_id,
    chatbot_id: bot.id,
    content: 'test content',
    source_url: dummyUrl
  });

  if (insertError) {
    console.error("Insert error:", insertError);
    return;
  }
  console.log("Inserted chunk for", dummyUrl);

  // 3. Verify it's there
  let { data: chunks1 } = await supabaseAdmin.from('document_chunks').select('id').eq('source_url', dummyUrl);
  console.log("Chunks before delete:", chunks1?.length);

  // 4. Delete it the way the API does
  let query = supabaseAdmin
      .from('document_chunks')
      .delete()
      .eq('chatbot_id', bot.id)
      .eq('source_url', dummyUrl);

  const { error: deleteError } = await query;
  if (deleteError) {
    console.error("Delete error:", deleteError);
  } else {
    console.log("Delete query executed without error.");
  }

  // 5. Verify it's gone
  let { data: chunks2 } = await supabaseAdmin.from('document_chunks').select('id').eq('source_url', dummyUrl);
  console.log("Chunks after delete:", chunks2?.length);

}
run();
