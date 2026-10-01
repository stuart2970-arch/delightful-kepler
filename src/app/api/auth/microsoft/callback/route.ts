import { NextRequest } from 'next/server';
import { GET as handleCallback } from '@/app/api/integrations/microsoft/callback/route';

export async function GET(request: NextRequest) {
  return handleCallback(request);
}
