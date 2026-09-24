import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: Request) {
  try {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe API key not configured on server' }, { status: 500, headers: corsHeaders });
    }

    const { searchParams } = new URL(req.url);
    const plan = searchParams.get('plan') || 'basic';
    const returnUrl = searchParams.get('return_url') || searchParams.get('returnUrl');

    const stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });

    const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
    const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';

    const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency: 'gbp',
      product_data: {
        name: 'StyleFlo Basic Plan (£9.99/mo)',
        description: '24/7 AI Receptionist Automation with Web Chatbot, Knowledge Base & Modular Bolt-ons',
        metadata: {
          plan_tier: 'base_tier',
          tier: 'base_tier',
          type: 'subscription',
        },
      },
      unit_amount: 999, // £9.99/mo
      recurring: {
        interval: 'month',
      },
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: priceData,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          plan_tier: 'base_tier',
        },
      },
      metadata: {
        plan_tier: 'base_tier',
      },
      success_url: `${returnUrl || wpAppUrl}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl || (isLocal ? 'https://styleflo.test/#pricing' : 'https://styleflo.ai/#pricing')}?checkout_status=cancelled`,
    });

    return NextResponse.redirect(session.url, 303);
  } catch (err: any) {
    console.error('Stripe Checkout GET Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to initiate checkout' }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Stripe API key not configured on server' }, { status: 500, headers: corsHeaders });
    }

    const stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { plan, planTier, tier, priceId, addonPriceIds, addonCatalogId, tenantId, customerEmail, returnUrl, action, customPricePence, customVoiceMinutes, customSms, autoTopup, autoTopupThreshold } = body;

    // Mode 3: Customer Portal
    if (action === 'portal') {
      if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId for portal' }, { status: 400 });
      }

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .maybeSingle();

      let stripeCustomerId = tenant?.stripe_customer_id;

      // Fallback: If tenant has no stripe_customer_id saved, look up customer by email in Stripe
      if (!stripeCustomerId) {
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
          const existingCustomers = await stripe.customers.list({
            email: resolvedEmail,
            limit: 1,
          });
          if (existingCustomers.data.length > 0) {
            stripeCustomerId = existingCustomers.data[0].id;
            await supabase
              .from('tenants')
              .update({ stripe_customer_id: stripeCustomerId })
              .eq('id', tenantId);
          }
        }
      }

      if (!stripeCustomerId) {
        return NextResponse.json({ 
          error: 'No Stripe billing profile found for this workspace yet. Receipts and invoices will appear here automatically after your first subscription or add-on is purchased.',
          noCustomer: true 
        }, { status: 200 });
      }

      const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
      const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';
      const defaultReturnUrl = wpAppUrl;

      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl || defaultReturnUrl,
      });

      return NextResponse.json({ url: session.url }, { headers: corsHeaders });
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

      const finalVoiceMinutes = (addon.category === 'mobile' || addonCatalogId === 'mobile_addon')
        ? 0
        : (customVoiceMinutes !== undefined && Number(customVoiceMinutes) >= 0)
          ? Math.round(Number(customVoiceMinutes))
          : (addon.included_voice_minutes || 0);

      const finalSms = (customSms !== undefined && Number(customSms) >= 0)
        ? Math.round(Number(customSms))
        : (addon.included_sms || 0);

      const isOneOff = 
        addon.category === 'sms_pack' || 
        addonCatalogId?.startsWith('sms_pack') ||
        addon.category === 'voice_pack' || 
        addonCatalogId?.startsWith('voice_pack');

      // Construct line item: use static price if available and no custom pricing was chosen;
      // otherwise, dynamically create a recurring price using price_data.
      let lineItem: Stripe.Checkout.SessionCreateParams.LineItem;

      if (addon.stripe_price_id && !customPricePence && !isOneOff) {
        lineItem = {
          price: addon.stripe_price_id,
          quantity: 1,
        };
      } else {
        // Build descriptive line item title & description
        let lineDescription = addon.description || addon.name;
        if (addon.category === 'mobile' || addonCatalogId === 'mobile_addon') {
          lineDescription = `Includes dedicated UK mobile number (07) for WhatsApp and ${finalSms} SMS messages`;
        } else if (addon.category === 'voice_pack' || addonCatalogId?.startsWith('voice_pack')) {
          lineDescription = `One-off pack of ${finalVoiceMinutes} voice minutes (Valid for 3 months from purchase)`;
        } else if (finalVoiceMinutes > 0 && finalSms > 0) {
          lineDescription = `Includes ${finalVoiceMinutes} shared voice mins + ${finalSms} SMS messages`;
        } else if (finalVoiceMinutes > 0) {
          lineDescription = `Includes dedicated number + ${finalVoiceMinutes} shared voice mins`;
        } else if (finalSms > 0) {
          lineDescription = isOneOff
            ? `One-off pack of ${finalSms} SMS messages (Valid for 3 months from purchase)`
            : `Includes ${finalSms} SMS messages`;
        }

        const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
          currency: 'gbp',
          product_data: {
            name: `${addon.name}${customPricePence ? ` (£${(finalPricePence / 100).toFixed(2)}${isOneOff ? '' : '/mo'})` : ''}`,
            description: lineDescription,
            metadata: {
              addon_catalog_id: addonCatalogId,
              tenant_id: tenantId,
            },
          },
          unit_amount: finalPricePence,
        };

        if (!isOneOff) {
          priceData.recurring = {
            interval: 'month',
          };
        }

        lineItem = {
          price_data: priceData,
          quantity: 1,
        };
      }

      const metadataPayload: Record<string, string> = {
        tenant_id: tenantId,
        is_addon: 'true',
        is_one_off: isOneOff ? 'true' : 'false',
        addon_catalog_id: addonCatalogId,
        custom_price_pence: String(finalPricePence),
        custom_voice_minutes: String(finalVoiceMinutes),
        custom_sms: String(finalSms),
        auto_topup: autoTopup ? 'true' : 'false',
        auto_topup_threshold: String(autoTopupThreshold || 10),
      };

      if (autoTopup && tenantId && (addon.category === 'voice_pack' || addonCatalogId?.startsWith('voice_pack'))) {
        await supabase
          .from('tenants')
          .update({
            voice_auto_topup: true,
            voice_auto_topup_threshold: Number(autoTopupThreshold) || 10,
            voice_auto_topup_amount: finalVoiceMinutes,
            voice_auto_topup_price_pence: finalPricePence,
          })
          .eq('id', tenantId);
      }

      const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
      const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        mode: isOneOff ? 'payment' : 'subscription',
        payment_method_types: ['card'],
        line_items: [lineItem],
        metadata: metadataPayload,
        ...(isOneOff
          ? { invoice_creation: { enabled: true } }
          : { subscription_data: { metadata: metadataPayload } }),
        success_url: `${returnUrl || wpAppUrl}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || wpAppUrl}?checkout_status=cancelled`,
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
        if (isOneOff) {
          sessionConfig.customer_creation = 'always';
        }
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);
      return NextResponse.json({ url: session.url, sessionId: session.id }, { headers: corsHeaders });
    }

    // Mode 1: New subscription checkout
    const isBaseTierRequest =
      plan === 'basic' ||
      plan === 'base_tier' ||
      planTier === 'base_tier' ||
      tier === 'base_tier' ||
      tier === 'basic' ||
      priceId === 'basic' ||
      priceId === 'base_tier';

    if (isBaseTierRequest || priceId) {
      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      if (priceId && priceId !== 'basic' && priceId !== 'base_tier') {
        lineItems.push({
          price: priceId,
          quantity: 1,
        });
      } else {
        const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
          currency: 'gbp',
          product_data: {
            name: 'StyleFlo Basic Plan (£9.99/mo)',
            description: '24/7 AI Receptionist Automation with Web Chatbot, Knowledge Base & Modular Bolt-ons',
            metadata: {
              plan_tier: 'base_tier',
              tier: 'base_tier',
              type: 'subscription',
            },
          },
          unit_amount: 999, // £9.99/mo
          recurring: {
            interval: 'month',
          },
        };
        lineItems.push({
          price_data: priceData,
          quantity: 1,
        });
      }

      if (Array.isArray(addonPriceIds) && addonPriceIds.length > 0) {
        addonPriceIds.forEach(id => {
          lineItems.push({
            price: id,
            quantity: 1,
          });
        });
      }

      const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
      const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: lineItems,
        subscription_data: {
          metadata: {
            tenant_id: tenantId || '',
            plan_tier: 'base_tier',
          },
        },
        metadata: {
          tenant_id: tenantId || '',
          plan_tier: 'base_tier',
        },
        success_url: `${returnUrl || wpAppUrl}?checkout_status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || (isLocal ? 'https://styleflo.test/#pricing' : 'https://styleflo.ai/#pricing')}?checkout_status=cancelled`,
      });

      return NextResponse.json({ url: session.url, sessionId: session.id }, { headers: corsHeaders });
    }

    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400, headers: corsHeaders });

  } catch (err: any) {
    console.error('Stripe Checkout Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process request' }, { status: 500, headers: corsHeaders });
  }
}
