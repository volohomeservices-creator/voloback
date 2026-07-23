import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, 'admin');
    const { id: workerId } = await params;
    
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('booking_id');

    if (!bookingId) {
      return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
    }

    // Fetch booking to get timeframe
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('created_at, completed_at, lat, lng')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Fetch location history within booking timeframe
    const startTime = booking.created_at;
    const endTime = booking.completed_at || new Date().toISOString();

    const { data: locations, error: locError } = await supabaseAdmin
      .from('worker_location_logs')
      .select('lat, lng, recorded_at')
      .eq('worker_id', workerId)
      .gte('recorded_at', startTime)
      .lte('recorded_at', endTime)
      .order('recorded_at', { ascending: true });

    if (locError) throw locError;

    return NextResponse.json({ 
      locations: locations || [],
      customerLocation: { lat: booking.lat, lng: booking.lng }
    });
  } catch (error: any) {
    console.error('Error fetching location history:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
