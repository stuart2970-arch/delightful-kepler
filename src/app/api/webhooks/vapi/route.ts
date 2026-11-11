import { NextResponse } from 'next/server';
import { verifyVapiWebhookSecret } from '@/lib/env/vapi-webhook-auth';
import { handleEndOfCallReport, unwrapVapiMessage } from '@/lib/voice/end-of-call-report';

// Vapi posts every server event here when the org, phone number, or call
// server URL points at /api/webhooks/vapi. assistant-request is answered by
// the assistant route. end-of-call-report is stored once per call id.
export async function POST(request: Request) {
  try {
    const auth = verifyVapiWebhookSecret(request);
    if (!auth.ok) return auth.response;

    const raw = await request.text();
    let body: unknown = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    }

    const message = unwrapVapiMessage(body);
    if (message?.type === 'assistant-request') {
      const { POST: assistantPost } = await import('./assistant/route');
      return assistantPost(new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: raw,
      }));
    }

    if (!message || message.type !== 'end-of-call-report') {
      return NextResponse.json({ success: true, ignored: true });
    }

    return handleEndOfCallReport(body);
  } catch (err) {
    console.error('[Vapi Webhook] Error processing webhook', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
