import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const confirmationCode = 'del_' + Math.random().toString(36).substring(2, 12);
    const trackingUrl = `https://styleflo.ai/data-deletion?code=${confirmationCode}`;

    return NextResponse.json({
      url: trackingUrl,
      confirmation_code: confirmationCode,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'active',
    instructions: 'To request deletion of your messaging data, please visit https://styleflo.ai/data-deletion or email privacy@styleflo.ai with your phone number or account ID.',
  });
}
