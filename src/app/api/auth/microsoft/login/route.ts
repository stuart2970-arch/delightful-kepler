import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const url = new URL(request.url);
  const staffId = url.searchParams.get('staffId');
  const targetUrl = `${appUrl}/api/integrations/microsoft/authorize${staffId ? `?staffId=${staffId}` : ''}`;
  return NextResponse.redirect(targetUrl);
}
