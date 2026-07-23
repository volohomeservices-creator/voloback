import { NextResponse } from 'next/server';
import { getPlaceDetails } from '@/lib/maps/directions-service';
import { requireSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    // Enforce authentication check
    await requireSession(request);

    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get('placeId') || '';

    if (!placeId) {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }

    const details = await getPlaceDetails(placeId);
    if (!details) {
      return NextResponse.json({ error: 'Place details not found' }, { status: 404 });
    }

    return NextResponse.json({ details });
  } catch (error: any) {
    console.error('Place Details API route error:', error);
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
