#!/usr/bin/env node
/**
 * Create the two Stripe Customer Portal configurations used by /api/billing/checkout.
 * TEST MODE ONLY. Does not run against a live Stripe account.
 *
 * Required:
 *   STRIPE_SECRET_KEY=sk_test_...
 *   STRIPE_PORTAL_SETUP_CONFIRM=TEST_MODE_YES
 *
 * This script is idempotent: it reuses existing configs tagged with
 * metadata.styleflo_portal_role = owner|admin.
 *
 * Do not run this against any real / live account. sk_live_* is refused.
 */
const Stripe = require('stripe');

function fail(message) {
  console.error(`[setup-stripe-portal-configs] ${message}`);
  process.exit(1);
}

async function main() {
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) fail('STRIPE_SECRET_KEY is required');
  if (secretKey.startsWith('sk_live_')) fail('Refusing live Stripe keys. Test mode only.');
  if (!secretKey.startsWith('sk_test_')) fail('STRIPE_SECRET_KEY must be a sk_test_ key');
  if (process.env.STRIPE_PORTAL_SETUP_CONFIRM !== 'TEST_MODE_YES') {
    fail('Set STRIPE_PORTAL_SETUP_CONFIRM=TEST_MODE_YES to run this test-mode script');
  }
  if (secretKey === 'sk_test_mock') {
    console.log('[setup-stripe-portal-configs] sk_test_mock — dry run, nothing created.');
    console.log('Would create:');
    console.log('  owner: cancel on (at_period_end), subscription_update on, login_page off');
    console.log('  admin: cancel off, subscription_update off, login_page off');
    console.log('  default: cancel off, subscription_update off, login_page off (never fail open)');
    return;
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });

  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const byRole = new Map();
  for (const cfg of existing.data) {
    const role = cfg.metadata?.styleflo_portal_role;
    if (role) byRole.set(role, cfg);
  }

  const shared = {
    business_profile: {
      headline: 'StyleFlo billing',
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
    },
    login_page: { enabled: false },
  };

  const specs = [
    {
      role: 'owner',
      features: {
        ...shared.features,
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        subscription_update: { enabled: true, default_allowed_updates: ['price'] },
      },
    },
    {
      role: 'admin',
      features: {
        ...shared.features,
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
    },
  ];

  for (const spec of specs) {
    const found = byRole.get(spec.role);
    if (found) {
      const updated = await stripe.billingPortal.configurations.update(found.id, {
        business_profile: shared.business_profile,
        features: spec.features,
        login_page: shared.login_page,
        metadata: { styleflo_portal_role: spec.role },
      });
      console.log(`Updated ${spec.role} portal config: ${updated.id}`);
      continue;
    }
    const created = await stripe.billingPortal.configurations.create({
      business_profile: shared.business_profile,
      features: spec.features,
      login_page: shared.login_page,
      metadata: { styleflo_portal_role: spec.role },
    });
    console.log(`Created ${spec.role} portal config: ${created.id}`);
  }

  const safeDefaultFeatures = {
    ...shared.features,
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
  };
  const defaults = existing.data.filter((cfg) => cfg.is_default);
  if (defaults.length === 0) {
    console.log('No default portal configuration found to harden.');
  }
  for (const def of defaults) {
    const updated = await stripe.billingPortal.configurations.update(def.id, {
      features: safeDefaultFeatures,
      login_page: shared.login_page,
    });
    console.log(`Hardened default portal config (cancel off, plan change off): ${updated.id}`);
  }

  console.log('Set STRIPE_PORTAL_CONFIG_OWNER / STRIPE_PORTAL_CONFIG_ADMIN to the printed IDs (test mode).');
}

main().catch((err) => fail(err.message || String(err)));
