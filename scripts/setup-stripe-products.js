// @ts-check
/**
 * Setup Script for StyleFlo.ai Products & Pricing Tiers in Stripe
 * 
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_12345 node scripts/setup-stripe-products.js
 */

const Stripe = require('stripe');

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('❌ Error: STRIPE_SECRET_KEY environment variable is missing.');
    console.log('\nPlease run:');
    console.log('  STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-products.js');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });

  console.log('🚀 Setting up StyleFlo.ai Products & 30-Day Free Trial Prices in Stripe...\n');

  const productsToCreate = [
    {
      name: 'StyleFlo Basic Tier',
      description: 'Solo Stylists & Starters - 1,000 msgs/mo, 50 Vector Chunks, Lead Capture, Dashboard Visibility',
      metadata: { tier: 'basic', promo: '1monthfree' },
      monthlyPrice: 599, // £5.99 in pence
      annualPrice: 5990, // £59.90 in pence
    },
    {
      name: 'StyleFlo Starter Tier',
      description: 'Growing Independent Salons - 5,000 msgs/mo, 1,000 Vector Chunks, 1 Cal Sync, 3 Staff Rotas, 15 Products/Services, 4 British Accents (30m)',
      metadata: { tier: 'starter', promo: '1monthfree' },
      monthlyPrice: 2900, // £29.00 in pence
      annualPrice: 29000, // £290.00 in pence
    },
    {
      name: 'StyleFlo Premium Tier',
      description: 'High-Volume & Multi-Chair Salons - 15,000 msgs/mo, 5,000 Vector Chunks, 6 Cal Connections, 6 Rotas, Footer Removed, 50 Products/Services, Dedicated Mobile & WhatsApp',
      metadata: { tier: 'premium', promo: '1monthfree' },
      monthlyPrice: 7900, // £79.00 in pence
      annualPrice: 79000, // £790.00 in pence
    },
    {
      name: 'StyleFlo Ultimate Tier',
      description: 'Enterprise & Franchise Groups - Unlimited Quotas, FloVoice Infrastructure, Bespoke API Integration',
      metadata: { tier: 'ultimate', poa: 'true' },
      monthlyPrice: null,
      annualPrice: null,
    }
  ];

  const results = [];

  for (const item of productsToCreate) {
    console.log(`📦 Creating Product: ${item.name}...`);
    
    // Create Product
    const product = await stripe.products.create({
      name: item.name,
      description: item.description,
      metadata: item.metadata,
    });

    let monthlyPriceObj = null;
    let annualPriceObj = null;

    if (item.monthlyPrice !== null) {
      // Monthly Price
      monthlyPriceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: item.monthlyPrice,
        currency: 'gbp',
        recurring: { interval: 'month' },
        metadata: { billing_period: 'monthly', trial_days: '30' },
      });

      // Annual Price
      annualPriceObj = await stripe.prices.create({
        product: product.id,
        unit_amount: item.annualPrice,
        currency: 'gbp',
        recurring: { interval: 'year' },
        metadata: { billing_period: 'annual', trial_days: '30' },
      });
    }

    results.push({
      tier: item.name,
      productId: product.id,
      monthlyPriceId: monthlyPriceObj ? monthlyPriceObj.id : 'N/A (POA)',
      annualPriceId: annualPriceObj ? annualPriceObj.id : 'N/A (POA)',
    });
  }

  console.log('\n✅ Successfully Created All Products & Prices in Stripe!\n');
  console.table(results);
  
  console.log('\n💡 Tip: Add these Price IDs to your .env or Supabase settings to handle checkout sessions with a 30-day free trial (`subscription_data.trial_period_days = 30`).');
}

main().catch((err) => {
  console.error('❌ Failed to execute Stripe setup:', err);
  process.exit(1);
});
