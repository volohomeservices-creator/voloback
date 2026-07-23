import { NextResponse } from 'next/server';
import { reverseGeocodeCoordinates } from '@/lib/maps/geocoding-service';
import { requireSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    // Enforce authentication check
    await requireSession(request);

    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: 'lat and lng must be numbers' }, { status: 400 });
    }

    const result = await reverseGeocodeCoordinates(lat, lng);
    if (!result) {
      return NextResponse.json({ error: 'Could not resolve address' }, { status: 404 });
    }

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Reverse Geocode API route error:', error);
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
