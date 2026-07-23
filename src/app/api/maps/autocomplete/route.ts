import { NextResponse } from 'next/server';
import { getAutocompleteSuggestions } from '@/lib/maps/directions-service';
import { requireSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    // Enforce authentication check
    await requireSession(request);

    const { searchParams } = new URL(request.url);
    const input = searchParams.get('input') || '';

    if (!input) {
      return NextResponse.json({ predictions: [] });
    }

    const predictions = await getAutocompleteSuggestions(input);
    return NextResponse.json({ predictions });
  } catch (error: any) {
    console.error('Autocomplete API route error:', error);
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
