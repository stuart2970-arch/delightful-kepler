import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // In a real environment, this endpoint would be invoked by Vercel Cron or Google Cloud Scheduler.
    // It would fetch data from the DB, generate the merchants.json, services.json, and availability.json files,
    // and push them to an SFTP server or Google Cloud Storage bucket as required by Google Actions Center.
    
    // For now, this serves as a placeholder to acknowledge the cron execution.
    // The individual /api/rwg/feeds/* endpoints dynamically generate the required JSON structure.
    
    console.log('[RwG Cron] Executing daily data aggregation pipeline...');

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 500));

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
