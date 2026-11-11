import { NextRequest, NextResponse } from 'next/server';
import { verifyMetaSignedRequest } from '@/lib/meta-signed-request';

export const dynamic = 'force-dynamic';

async function readSignedRequest(request: NextRequest): Promise<string | undefined> {
  const fromQuery = request.nextUrl.searchParams.get('signed_request');
  if (fromQuery) return fromQuery;

  const raw = await request.text();
  if (!raw) return undefined;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(raw) as { signed_request?: unknown };
      return typeof body.signed_request === 'string' ? body.signed_request : undefined;
    } catch {
      return undefined;
    }
  }

  return new URLSearchParams(raw).get('signed_request') ?? undefined;
}

export async function POST(request: NextRequest) {
  const signedRequest = await readSignedRequest(request);
  if (!signedRequest) {
    return NextResponse.json({ error: 'Malformed signed_request' }, { status: 400 });
  }

  const verified = verifyMetaSignedRequest(signedRequest, process.env.META_APP_SECRET);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  const confirmationCode = `del_${verified.userId}_${Math.random().toString(36).slice(2, 12)}`;
  const trackingUrl = `https://styleflo.ai/data-deletion?code=${encodeURIComponent(confirmationCode)}`;

  return NextResponse.json({
    url: trackingUrl,
    confirmation_code: confirmationCode,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    instructions:
      'To request deletion of your messaging data, please visit https://styleflo.ai/data-deletion or email privacy@styleflo.ai with your phone number or account ID.',
  });
}
