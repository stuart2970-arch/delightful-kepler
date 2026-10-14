import { NextRequest } from 'next/server';
import { POST as handleTwilioSms, GET as handleTwilioSmsGet } from '@/app/api/webhooks/twilio/sms/route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handleTwilioSms(req);
}

export async function GET(req: NextRequest) {
  return handleTwilioSmsGet(req);
}
