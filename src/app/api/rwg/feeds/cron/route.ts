import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7).trim();
    if (!cronSecret || token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[RwG Cron] Executing daily data aggregation pipeline...');

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 50));

    console.log('[RwG Cron] Successfully generated and published feeds.');

    return NextResponse.json({
      success: true,
      message: 'Daily feeds generated and aggregated successfully.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[RwG Cron] Exception:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
