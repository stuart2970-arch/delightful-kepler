const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

async function setupStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('Missing STRIPE_SECRET_KEY in .env.local');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2025-01-27.acacia',
  });

  console.log('--- Step 1: Validating Stripe Account ---');
  try {
    const account = await stripe.accounts.retrieve();
    console.log(`Account ID: ${account.id}`);
    console.log(`Country: ${account.country || 'N/A'}`);
    console.log(`Default Currency: ${account.default_currency || 'N/A'}`);
    console.log(`Email: ${account.email || 'N/A'}`);
  } catch (err) {
    console.error('Failed to retrieve account details:', err.message);
    process.exit(1);
  }

  console.log('\n--- Step 2: Registering Webhook Endpoint ---');
  const targetWebhookUrl = 'https://app.styleflo.ai/api/webhooks/stripe';
  const eventsToListen = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
  ];

  let webhookSecret = null;
  try {
    const existingEndpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    const existing = existingEndpoints.data.find(e => e.url === targetWebhookUrl);

    if (existing) {
      console.log(`Existing webhook endpoint found: ${existing.id} (${existing.status})`);
      // Update events if needed
      const updated = await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: eventsToListen,
      });
      console.log(`Webhook endpoint ${updated.id} updated with required events.`);
      console.log(`NOTE: Stripe does not return existing secrets via API after creation.`);
      // Check if we already have it in env or need to create a new one
      if (process.env.STRIPE_WEBHOOK_SECRET) {
        webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        console.log(`Reusing existing STRIPE_WEBHOOK_SECRET from .env.local: ${webhookSecret.slice(0, 10)}...`);
      } else {
        console.log(`Creating fresh endpoint to capture newly minted signing secret...`);
        await stripe.webhookEndpoints.del(existing.id);
        const fresh = await stripe.webhookEndpoints.create({
          url: targetWebhookUrl,
          enabled_events: eventsToListen,
          description: 'StyleFlo Production Webhook (Auto-configured)',
        });
        webhookSecret = fresh.secret;
        console.log(`Created new webhook endpoint ${fresh.id} with secret: ${webhookSecret.slice(0, 10)}...`);
      }
    } else {
      console.log(`Creating new webhook endpoint for ${targetWebhookUrl}...`);
      const created = await stripe.webhookEndpoints.create({
        url: targetWebhookUrl,
        enabled_events: eventsToListen,
        description: 'StyleFlo Production Webhook (Auto-configured)',
      });
      webhookSecret = created.secret;
      console.log(`Successfully created webhook endpoint ${created.id}!`);
      console.log(`Signing Secret: ${webhookSecret.slice(0, 10)}...`);
    }
  } catch (err) {
    console.error('Error configuring webhook endpoint:', err.message);
    process.exit(1);
  }

  console.log('\n--- Step 3: Configuring Stripe Customer Portal ---');
  try {
    const portalConfig = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'Manage your StyleFlo Subscription & Add-ons',
      },
      features: {
        customer_update: {
          allowed_updates: ['address', 'phone', 'email', 'tax_id'],
          enabled: true,
        },
        invoice_history: {
          enabled: true,
        },
        payment_method_update: {
          enabled: true,
        },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          proration_behavior: 'none',
        },
      },
    });
    console.log(`Customer Portal successfully configured! Portal ID: ${portalConfig.id}`);
  } catch (err) {
    console.warn(`Customer Portal note: ${err.message}`);
  }

  console.log('\n--- Step 4: Updating .env.local ---');
  if (webhookSecret) {
    const envPath = path.resolve(__dirname, '../.env.local');
    let envContent = fs.readFileSync(envPath, 'utf8');

    if (envContent.includes('STRIPE_WEBHOOK_SECRET=')) {
      envContent = envContent.replace(/STRIPE_WEBHOOK_SECRET=.*(\r?\n|$)/, `STRIPE_WEBHOOK_SECRET=${webhookSecret}$1`);
    } else {
      envContent = envContent.trimEnd() + `\nSTRIPE_WEBHOOK_SECRET=${webhookSecret}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`Successfully saved STRIPE_WEBHOOK_SECRET into .env.local!`);
  }

  console.log('\n✅ Programmatic Stripe Setup Completed Successfully!');
}

setupStripe();
