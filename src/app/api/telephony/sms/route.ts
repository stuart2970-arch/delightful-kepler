import { NextRequest } from 'next/server';
import { POST as twilioSmsPost } from '../../webhooks/twilio/sms/route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return twilioSmsPost(request);
}
