import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables are missing');
  }
  return createClient(supabaseUrl, supabaseKey);
}

function appendQueryParams(baseUrl: string, queryParams: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${queryParams}`;
}

function parseAddonIds(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(s => String(s).trim()).filter(Boolean);
  if (typeof input === 'string') {
    return input.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

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
    const returnUrl = searchParams.get('return_url') || searchParams.get('returnUrl');
    const rawAddons = searchParams.get('addons') || searchParams.get('addonCatalogIds');
    const customerEmail = searchParams.get('customerEmail') || searchParams.get('email');
    const selectedAddonIds = parseAddonIds(rawAddons);

    const stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });

    const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';

    const supabase = getSupabase();

    // Fetch Foundation plan pricing from subscription_tiers
    const { data: tiers, error: tierError } = await supabase
      .from('subscription_tiers')
      .select('id, name, monthly_price')
      .in('id', ['foundation', 'base_tier'])
      .eq('is_active', true);

    const foundationTier = tiers?.find(t => t.id === 'foundation') || tiers?.find(t => t.id === 'base_tier');
    if (tierError || !foundationTier || foundationTier.monthly_price == null) {
      return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
    }

    const foundationUnitAmount = Math.round(Number(foundationTier.monthly_price) * 100);
    const foundationName = `StyleFlo ${foundationTier.name || 'Foundation Plan'}`;

    const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency: 'gbp',
      product_data: {
        name: foundationName,
        description: '24/7 AI Receptionist Automation with Web Chatbot, Knowledge Base & Modular Bolt-ons',
        metadata: {
          plan_tier: 'base_tier',
          tier: 'base_tier',
          type: 'subscription',
        },
      },
      unit_amount: foundationUnitAmount,
      recurring: {
        interval: 'month',
      },
    };

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: priceData,
        quantity: 1,
      },
    ];

    // Query addon_catalog in Supabase to ensure prices are driven from /superadmin values
    if (selectedAddonIds.length > 0) {
      const { data: dbAddons, error: addonError } = await supabase
        .from('addon_catalog')
        .select('id, name, description, monthly_price_pence, category')
        .in('id', selectedAddonIds)
        .eq('is_active', true)
        .neq('id', 'whatsapp_primary');

      if (addonError || !dbAddons) {
        return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
      }

      const dbAddonMap = new Map(dbAddons.map(a => [a.id, a]));

      for (const addonId of selectedAddonIds) {
        const addon = dbAddonMap.get(addonId);
        if (!addon) {
          return NextResponse.json({ error: `Add-on not found in catalog: ${addonId}` }, { status: 400, headers: corsHeaders });
        }

        lineItems.push({
          price_data: {
            currency: 'gbp',
            product_data: {
              name: addon.name,
              description: addon.description || '',
              metadata: {
                addon_catalog_id: addon.id,
                category: addon.category,
                type: 'addon',
              },
            },
            unit_amount: addon.monthly_price_pence,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        });
      }
    }

    const sessionMetadata: Record<string, string> = {
      plan_tier: 'base_tier',
    };
    if (selectedAddonIds.length > 0) {
      sessionMetadata.selected_addons = selectedAddonIds.join(',');
    }

    const defaultConfirmedUrl = isLocal ? 'http://localhost:3000/payment-confirmed' : 'https://app.styleflo.ai/payment-confirmed';
    const targetSuccessUrl = returnUrl || defaultConfirmedUrl;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: lineItems,
      subscription_data: {
        metadata: sessionMetadata,
      },
      metadata: sessionMetadata,
      success_url: appendQueryParams(targetSuccessUrl, 'checkout_status=success&session_id={CHECKOUT_SESSION_ID}'),
      cancel_url: appendQueryParams(returnUrl || (isLocal ? 'https://styleflo.test/#pricing' : 'https://styleflo.ai/#pricing'), 'checkout_status=cancelled'),
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

    const supabase = getSupabase();

    const body = await req.json().catch(() => ({}));
    const { plan, planTier, tier, priceId, addonPriceIds, addonCatalogId, tenantId, customerEmail, returnUrl, action, customPricePence, customVoiceMinutes, customSms, autoTopup, autoTopupThreshold } = body;

    // Mode 3: Customer Portal
    if (action === 'portal') {
      if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId for portal' }, { status: 400 });
      }

      const { data: tenant } = await supabase
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

      let finalPricePence = addon.monthly_price_pence;
      let finalVoiceMinutes = addon.included_voice_minutes || 0;
      let finalSms = addon.included_sms || 0;

      // Validate client-supplied customPricePence
      if (customPricePence !== undefined && customPricePence !== null && customPricePence !== '') {
        const priceNum = Number(customPricePence);
        const minPrice = addon.monthly_price_pence;
        const maxPrice = addon.max_price_pence;
        const stepPence = addon.price_step_pence || 100;

        if (!addon.is_sliding || maxPrice == null || isNaN(priceNum) || priceNum < minPrice || priceNum > maxPrice) {
          return NextResponse.json({ error: 'Invalid custom price: out of allowed range' }, { status: 400, headers: corsHeaders });
        }

        if ((priceNum - minPrice) % stepPence !== 0) {
          return NextResponse.json({ error: 'Invalid custom price: must be a multiple of step increments' }, { status: 400, headers: corsHeaders });
        }

        finalPricePence = Math.round(priceNum);
        const maxSteps = Math.max(1, Math.round((maxPrice - minPrice) / stepPence));
        const step = Math.round((finalPricePence - minPrice) / stepPence);

        if (addon.max_voice_minutes != null && addon.included_voice_minutes != null) {
          finalVoiceMinutes = Math.round(addon.included_voice_minutes + step * ((addon.max_voice_minutes - addon.included_voice_minutes) / maxSteps));
        }
        if (addon.max_sms != null && addon.included_sms != null) {
          finalSms = Math.round(addon.included_sms + step * ((addon.max_sms - addon.included_sms) / maxSteps));
        }
      }

      if (addon.category === 'mobile' || addonCatalogId === 'mobile_addon') {
        finalVoiceMinutes = 0;
      }

      const isOneOff = 
        addon.category === 'sms_pack' || 
        addonCatalogId?.startsWith('sms_pack') ||
        addon.category === 'voice_pack' || 
        addonCatalogId?.startsWith('voice_pack');

      // Option 1: Always use price_data with unit_amount from addon_catalog
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
          name: addon.name,
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

      const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
        price_data: priceData,
        quantity: 1,
      };

      const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';
      const wpAppUrl = isLocal ? 'https://styleflo.test/app' : 'https://styleflo.ai/app';
      const defaultSuccessUrl = wpAppUrl;
      const defaultCancelUrl = wpAppUrl;

      const targetSuccessUrl = returnUrl || defaultSuccessUrl;
      const targetCancelUrl = returnUrl || defaultCancelUrl;

      const sessionMetadata: Record<string, string> = {
        tenant_id: tenantId,
        addon_catalog_id: addonCatalogId,
        category: addon.category,
        is_sliding: addon.is_sliding ? 'true' : 'false',
        price_pence: String(finalPricePence),
        voice_minutes: String(finalVoiceMinutes),
        sms: String(finalSms),
        is_one_off: isOneOff ? 'true' : 'false',
      };

      if (autoTopup !== undefined) {
        sessionMetadata.auto_topup = String(Boolean(autoTopup));
        sessionMetadata.auto_topup_threshold = String(autoTopupThreshold || 10);
      }

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        mode: isOneOff ? 'payment' : 'subscription',
        payment_method_types: ['card'],
        customer: tenant?.stripe_customer_id || undefined,
        customer_email: (!tenant?.stripe_customer_id && customerEmail) ? customerEmail : undefined,
        line_items: [lineItem],
        metadata: sessionMetadata,
        success_url: appendQueryParams(targetSuccessUrl, `checkout_status=success&addon_id=${addonCatalogId}&session_id={CHECKOUT_SESSION_ID}`),
        cancel_url: appendQueryParams(targetCancelUrl, `checkout_status=cancelled&addon_id=${addonCatalogId}`),
      };

      if (!isOneOff) {
        sessionConfig.subscription_data = {
          metadata: sessionMetadata,
        };
      } else {
        sessionConfig.payment_intent_data = {
          metadata: sessionMetadata,
        };
      }

      if (!tenant?.stripe_customer_id && !customerEmail) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .limit(1)
          .maybeSingle();

        if (profile?.id) {
          const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
          if (userData?.user?.email) {
            sessionConfig.customer_email = userData.user.email;
          }
        }
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);
      return NextResponse.json({ url: session.url, sessionId: session.id }, { headers: corsHeaders });
    }

    // Mode 1: New subscription checkout
    const isBaseTierRequest =
      plan === 'foundation' ||
      plan === 'basic' ||
      plan === 'base_tier' ||
      planTier === 'base_tier' ||
      planTier === 'foundation' ||
      tier === 'base_tier' ||
      tier === 'foundation' ||
      tier === 'basic' ||
      priceId === 'foundation' ||
      priceId === 'basic' ||
      priceId === 'base_tier';

    if (isBaseTierRequest || priceId) {
      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      if (priceId && priceId !== 'foundation' && priceId !== 'basic' && priceId !== 'base_tier') {
        lineItems.push({
          price: priceId,
          quantity: 1,
        });
      } else {
        // Fetch Foundation plan pricing from subscription_tiers
        const { data: tiers, error: tierError } = await supabase
          .from('subscription_tiers')
          .select('id, name, monthly_price')
          .in('id', ['foundation', 'base_tier'])
          .eq('is_active', true);

        const foundationTier = tiers?.find(t => t.id === 'foundation') || tiers?.find(t => t.id === 'base_tier');
        if (tierError || !foundationTier || foundationTier.monthly_price == null) {
          return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
        }

        const foundationUnitAmount = Math.round(Number(foundationTier.monthly_price) * 100);
        const foundationName = `StyleFlo ${foundationTier.name || 'Foundation Plan'}`;

        const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
          currency: 'gbp',
          product_data: {
            name: foundationName,
            description: '24/7 AI Receptionist Automation with Web Chatbot, Knowledge Base & Modular Bolt-ons',
            metadata: {
              plan_tier: 'base_tier',
              tier: 'base_tier',
              type: 'subscription',
            },
          },
          unit_amount: foundationUnitAmount,
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

      // Modular addon IDs (google_calendar_addon, data_pack_500, landline_addon, mobile_addon, etc.)
      const rawAddons = body.addons || body.addonCatalogIds;
      const selectedAddonIds = parseAddonIds(rawAddons);

      if (selectedAddonIds.length > 0) {
        const { data: dbAddons, error: addonError } = await supabase
          .from('addon_catalog')
          .select('id, name, description, monthly_price_pence, category')
          .in('id', selectedAddonIds)
          .eq('is_active', true)
          .neq('id', 'whatsapp_primary');

        if (addonError || !dbAddons) {
          return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
        }

        const dbAddonMap = new Map(dbAddons.map(a => [a.id, a]));

        for (const addonId of selectedAddonIds) {
          const addon = dbAddonMap.get(addonId);
          if (!addon) {
            return NextResponse.json({ error: `Add-on not found in catalog: ${addonId}` }, { status: 400, headers: corsHeaders });
          }

          lineItems.push({
            price_data: {
              currency: 'gbp',
              product_data: {
                name: addon.name,
                description: addon.description || '',
                metadata: {
                  addon_catalog_id: addon.id,
                  category: addon.category,
                  type: 'addon',
                },
              },
              unit_amount: addon.monthly_price_pence,
              recurring: {
                interval: 'month',
              },
            },
            quantity: 1,
          });
        }
      }

      const isLocal = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENV === 'development';

      const sessionMetadata: Record<string, string> = {
        tenant_id: tenantId || '',
        plan_tier: 'base_tier',
      };
      if (selectedAddonIds.length > 0) {
        sessionMetadata.selected_addons = selectedAddonIds.join(',');
      }

      const defaultConfirmedUrl = isLocal ? 'http://localhost:3000/payment-confirmed' : 'https://app.styleflo.ai/payment-confirmed';
      const targetSuccessUrl = returnUrl || defaultConfirmedUrl;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: lineItems,
        subscription_data: {
          metadata: sessionMetadata,
        },
        metadata: sessionMetadata,
        success_url: appendQueryParams(targetSuccessUrl, 'checkout_status=success&session_id={CHECKOUT_SESSION_ID}'),
        cancel_url: appendQueryParams(returnUrl || (isLocal ? 'https://styleflo.test/#pricing' : 'https://styleflo.ai/#pricing'), 'checkout_status=cancelled'),
      });

      return NextResponse.json({ url: session.url, sessionId: session.id }, { headers: corsHeaders });
    }

    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400, headers: corsHeaders });

  } catch (err: any) {
    console.error('Stripe Checkout Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process request' }, { status: 500, headers: corsHeaders });
  }
}
