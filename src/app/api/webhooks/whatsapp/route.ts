import { NextRequest } from 'next/server';
import { GET as metaGet, POST as metaPost } from '../meta/route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return metaGet(request);
}

export async function POST(request: NextRequest) {
  return metaPost(request);
}
