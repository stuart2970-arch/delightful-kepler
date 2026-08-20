import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export async function POST(req: Request) {
  try {
    const { priceId, tenantId, customerEmail, returnUrl } = await req.json();

    if (!priceId) {
      return NextResponse.json({ error: 'Missing priceId parameter' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe API key not configured on server' }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
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
  } catch (err: any) {
    console.error('Stripe Checkout Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create Checkout session' }, { status: 500 });
  }
}
