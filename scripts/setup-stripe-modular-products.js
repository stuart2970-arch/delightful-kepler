// @ts-check
/**
 * Setup Script for StyleFlo.ai Modular Products & Pricing in Stripe
 *
 * Creates the £9.99/mo Base Tier plus all bolt-on add-on products.
 * All prices in GBP (pence).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_12345 node scripts/setup-stripe-modular-products.js
 */

const Stripe = require('stripe');

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('❌ Error: STRIPE_SECRET_KEY environment variable is missing.');
    console.log('\nPlease run:');
    console.log('  STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-modular-products.js');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });

  console.log('🚀 Setting up StyleFlo.ai Modular Products & Pricing in Stripe...\n');

  const productsToCreate = [
    // Base Tier
    {
      name: 'StyleFlo Base Subscription',
      description: 'AI Chatbot, web widget, knowledge base (500 chunks), 1500 chat messages/mo, 10 shared voice minutes, lead capture & web presence.',
      metadata: { tier: 'base_tier', type: 'subscription' },
      monthlyPricePence: 999,
      annualPricePence: 9990,
      catalogId: 'base_tier',
    },
    // Landline Addon
    {
      name: 'StyleFlo Landline Number',
      description: 'Dedicated local landline number with shared voice minutes (10-30 mins). Price varies by area code.',
      metadata: { type: 'addon', catalog_id: 'landline_addon' },
      monthlyPricePence: 899,
      annualPricePence: null,
      catalogId: 'landline_addon',
    },
    // Mobile Addon
    {
      name: 'StyleFlo Mobile Number',
      description: 'Dedicated mobile number with 50-250 SMS messages and shared voice minutes.',
      metadata: { type: 'addon', catalog_id: 'mobile_addon' },
      monthlyPricePence: 1099,
      annualPricePence: null,
      catalogId: 'mobile_addon',
    },
    // WhatsApp Primary
    {
      name: 'StyleFlo WhatsApp (Primary)',
      description: 'Standalone WhatsApp channel with 500 messages/mo.',
      metadata: { type: 'addon', catalog_id: 'whatsapp_primary' },
      monthlyPricePence: 1999,
      annualPricePence: null,
      catalogId: 'whatsapp_primary',
    },
    // WhatsApp Add-on
    {
      name: 'StyleFlo WhatsApp (Add-on)',
      description: 'WhatsApp channel add-on with 500 messages/mo. Requires active base subscription.',
      metadata: { type: 'addon', catalog_id: 'whatsapp_addon' },
      monthlyPricePence: 999,
      annualPricePence: null,
      catalogId: 'whatsapp_addon',
    },
    // Voice Packs
    {
      name: 'StyleFlo 20 Voice Minutes Pack',
      description: '20 additional shared voice minutes/mo with 3-month rollover.',
      metadata: { type: 'addon', catalog_id: 'voice_pack_20', rollover: '3_months' },
      monthlyPricePence: 1500,
      annualPricePence: null,
      catalogId: 'voice_pack_20',
    },
    {
      name: 'StyleFlo 50 Voice Minutes Pack',
      description: '50 additional shared voice minutes/mo with 3-month rollover.',
      metadata: { type: 'addon', catalog_id: 'voice_pack_50', rollover: '3_months' },
      monthlyPricePence: 3000,
      annualPricePence: null,
      catalogId: 'voice_pack_50',
    },
    {
      name: 'StyleFlo 100 Voice Minutes Pack',
      description: '100 additional shared voice minutes/mo with 3-month rollover.',
      metadata: { type: 'addon', catalog_id: 'voice_pack_100', rollover: '3_months' },
      monthlyPricePence: 5000,
      annualPricePence: null,
      catalogId: 'voice_pack_100',
    },
    // SMS Packs
    {
      name: 'StyleFlo 100 SMS Pack',
      description: '100 additional SMS messages/mo with 3-month rollover.',
      metadata: { type: 'addon', catalog_id: 'sms_pack_100', rollover: '3_months' },
      monthlyPricePence: 599,
      annualPricePence: null,
      catalogId: 'sms_pack_100',
    },
    {
      name: 'StyleFlo 500 SMS Pack',
      description: '500 additional SMS messages/mo with 3-month rollover.',
      metadata: { type: 'addon', catalog_id: 'sms_pack_500', rollover: '3_months' },
      monthlyPricePence: 1499,
      annualPricePence: null,
      catalogId: 'sms_pack_500',
    },
    // Data Pack
    {
      name: 'StyleFlo 500 Knowledge Base Chunks',
      description: '500 additional knowledge base data chunks for your AI agent.',
      metadata: { type: 'addon', catalog_id: 'data_pack_500' },
      monthlyPricePence: 999,
      annualPricePence: null,
      catalogId: 'data_pack_500',
    },
  ];

  const results = [];

  for (const item of productsToCreate) {
    console.log(`📦 Creating Product: ${item.name}...`);

    const product = await stripe.products.create({
      name: item.name,
      description: item.description,
      metadata: item.metadata,
    });

    let monthlyPriceObj = null;
    let annualPriceObj = null;

    // Monthly Price
    monthlyPriceObj = await stripe.prices.create({
      product: product.id,
      unit_amount: item.monthlyPricePence,
      currency: 'gbp',
      recurring: { interval: 'month' },
      metadata: {
        billing_period: 'monthly',
        catalog_id: item.catalogId,
        ...(item.catalogId === 'base_tier' ? { trial_days: '30' } : {}),
      },
    });

    // Annual Price (only for base tier)
    if (item.annualPricePence !== null) {
      annualPriceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: item.annualPricePence,
        currency: 'gbp',
        recurring: { interval: 'year' },
        metadata: {
          billing_period: 'annual',
          catalog_id: item.catalogId,
          trial_days: '30',
        },
      });
    }

    results.push({
      catalogId: item.catalogId,
      productName: item.name,
      productId: product.id,
      monthlyPriceId: monthlyPriceObj.id,
      annualPriceId: annualPriceObj ? annualPriceObj.id : 'N/A',
      monthlyGBP: `£${(item.monthlyPricePence / 100).toFixed(2)}`,
    });
  }

  console.log('\n✅ Successfully Created All Modular Products & Prices in Stripe!\n');
  console.table(results);

  console.log('\n💡 Next Steps:');
  console.log('1. Copy each monthlyPriceId into your Supabase addon_catalog.stripe_price_id column');
  console.log('2. Copy the base_tier monthlyPriceId into subscription_tiers.stripe_price_id');
  console.log('3. Update your .env with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');

  // Output SQL to update Supabase
  console.log('\n📋 SQL to update Supabase addon_catalog with Stripe Price IDs:\n');
  for (const r of results) {
    if (r.catalogId === 'base_tier') {
      console.log(`UPDATE public.subscription_tiers SET stripe_price_id = '${r.monthlyPriceId}' WHERE id = 'base_tier';`);
    } else {
      console.log(`UPDATE public.addon_catalog SET stripe_price_id = '${r.monthlyPriceId}' WHERE id = '${r.catalogId}';`);
    }
  }
}

main().catch((err) => {
  console.error('❌ Failed to execute Stripe setup:', err);
  process.exit(1);
});
