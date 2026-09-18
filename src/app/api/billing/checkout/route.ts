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
    const { priceId, addonPriceIds, addonCatalogId, tenantId, customerEmail, returnUrl, action, customPricePence, customVoiceMinutes, customSms } = body;

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

    // Mode 2: Add-on to existing subscription (Fixed or Sliding Scale)
    if (addonCatalogId && tenantId) {
      const { data: addon, error: addonError } = await supabase
        .from('addon_catalog')
        .select('*')
        .eq('id', addonCatalogId)
        .single();

      if (addonError || !addon) {
        return NextResponse.json({ error: 'Add-on not found in catalog' }, { status: 404 });
      }

      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id, company_name')
        .eq('id', tenantId)
        .maybeSingle();

      const finalPricePence = (customPricePence && Number(customPricePence) > 0)
        ? Math.round(Number(customPricePence))
        : addon.monthly_price_pence;

      const finalVoiceMinutes = (customVoiceMinutes !== undefined && Number(customVoiceMinutes) >= 0)
        ? Math.round(Number(customVoiceMinutes))
        : (addon.included_voice_minutes || 0);

      const finalSms = (customSms !== undefined && Number(customSms) >= 0)
        ? Math.round(Number(customSms))
        : (addon.included_sms || 0);

      // Construct line item: use static price if available and no custom pricing was chosen;
      // otherwise, dynamically create a recurring price using price_data.
      let lineItem: Stripe.Checkout.SessionCreateParams.LineItem;

      if (addon.stripe_price_id && !customPricePence) {
        lineItem = {
          price: addon.stripe_price_id,
          quantity: 1,
        };
      } else {
        // Build descriptive line item title & description
        let lineDescription = addon.description || addon.name;
        if (finalVoiceMinutes > 0 && finalSms > 0) {
          lineDescription = `Includes ${finalVoiceMinutes} shared voice mins + ${finalSms} SMS messages`;
        } else if (finalVoiceMinutes > 0) {
          lineDescription = `Includes dedicated number + ${finalVoiceMinutes} shared voice mins`;
        } else if (finalSms > 0) {
          lineDescription = `Includes ${finalSms} SMS messages`;
        }

        lineItem = {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `${addon.name}${customPricePence ? ` (£${(finalPricePence / 100).toFixed(2)}/mo)` : ''}`,
              description: lineDescription,
              metadata: {
                addon_catalog_id: addonCatalogId,
                tenant_id: tenantId,
              },
            },
            unit_amount: finalPricePence,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        };
      }

      const metadataPayload = {
        tenant_id: tenantId,
        is_addon: 'true',
        addon_catalog_id: addonCatalogId,
        custom_price_pence: String(finalPricePence),
        custom_voice_minutes: String(finalVoiceMinutes),
        custom_sms: String(finalSms),
      };

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [lineItem],
        metadata: metadataPayload,
        subscription_data: {
          metadata: metadataPayload,
        },
        success_url: `${returnUrl || 'https://app.styleflo.ai/dashboard'}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || 'https://app.styleflo.ai/dashboard'}?checkout_status=cancelled`,
      };

      if (tenant?.stripe_customer_id) {
        sessionConfig.customer = tenant.stripe_customer_id;
      } else {
        // Resolve tenant user email if available
        let resolvedEmail = customerEmail;
        if (!resolvedEmail) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('tenant_id', tenantId)
            .limit(1)
            .maybeSingle();

          if (profile?.id) {
            const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
            if (userData?.user?.email) {
              resolvedEmail = userData.user.email;
            }
          }
        }
        if (resolvedEmail) {
          sessionConfig.customer_email = resolvedEmail;
        }
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
