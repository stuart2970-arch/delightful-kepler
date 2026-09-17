const { getTenantEffectiveLimit } = require('./src/lib/entitlements');

async function test() {
  try {
    const limit = await getTenantEffectiveLimit('some-tenant-id', 'knowledge_data_chunks');
    console.log('Effective limit:', limit);
  } catch (e) {
    console.error(e);
  }
}
test();
