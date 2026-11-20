import { NextResponse } from 'next/server';
import { wingslabGoogleMapsEnabled } from '@sadel/shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  if (!wingslabGoogleMapsEnabled()) {
    return NextResponse.json({ enabled: false }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
  return NextResponse.json({ enabled: true, apiKey: process.env.WINGSLAB_GOOGLE_MAPS_API_KEY?.trim() }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
