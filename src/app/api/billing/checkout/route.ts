import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe API key not configured on server' }, { status: 500 });
    }

    const stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { priceId, addonPriceIds, addonCatalogId, tenantId, customerEmail, returnUrl, action } = body;

    // Mode 3: Customer Portal
    if (action === 'portal') {
      if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId for portal' }, { status: 400 });
      }

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant?.stripe_customer_id) {
        return NextResponse.json({ error: 'Customer not found or no Stripe customer ID associated' }, { status: 404 });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: returnUrl || 'https://app.styleflo.ai/dashboard/billing',
      });

      return NextResponse.json({ url: session.url });
    }

    // Mode 2: Add-on to existing subscription
    if (addonCatalogId && tenantId) {
      const { data: addon, error: addonError } = await supabase
        .from('addon_catalog')
        .select('stripe_price_id')
        .eq('id', addonCatalogId)
        .single();

      if (addonError || !addon?.stripe_price_id) {
        return NextResponse.json({ error: 'Add-on not found or missing Stripe price ID' }, { status: 404 });
      }

      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: addon.stripe_price_id,
            quantity: 1,
          },
        ],
        metadata: {
          tenant_id: tenantId,
          is_addon: 'true',
          addon_catalog_id: addonCatalogId
        },
        subscription_data: {
          metadata: {
            tenant_id: tenantId,
          }
        },
        success_url: `${returnUrl || 'https://app.styleflo.ai/dashboard'}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || 'https://app.styleflo.ai/dashboard'}?checkout_status=cancelled`,
      };

      if (tenant?.stripe_customer_id) {
        sessionConfig.customer = tenant.stripe_customer_id;
      } else if (customerEmail) {
        sessionConfig.customer_email = customerEmail;
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);
      return NextResponse.json({ url: session.url, sessionId: session.id });
    }

    // Mode 1: New subscription checkout
    if (priceId) {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        {
          price: priceId,
          quantity: 1,
        }
      ];

      if (Array.isArray(addonPriceIds) && addonPriceIds.length > 0) {
        addonPriceIds.forEach(id => {
          lineItems.push({
            price: id,
            quantity: 1,
          });
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: lineItems,
        subscription_data: {
          trial_period_days: 30, // 🎁 1 MONTH FREE TRIAL (30 Days)
          metadata: {
            tenant_id: tenantId || '',
          },
        },
        metadata: {
          tenant_id: tenantId || '',
        },
        success_url: `${returnUrl || 'https://app.styleflo.ai/dashboard'}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || 'https://styleflo.ai/#pricing'}?checkout_status=cancelled`,
      });

      return NextResponse.json({ url: session.url, sessionId: session.id });
    }

    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });

  } catch (err: any) {
    console.error('Stripe Checkout Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process request' }, { status: 500 });
  }
}
