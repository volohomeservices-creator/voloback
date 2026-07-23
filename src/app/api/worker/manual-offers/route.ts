import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

// Helper to calculate distance in km
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    // 1. Fetch worker location (prefer live location, fallback to profile coordinates)
    const [workerRes, liveLocRes] = await Promise.all([
      supabaseAdmin.from('workers').select('current_lat, current_lng').eq('id', workerId).single(),
      supabaseAdmin.from('worker_live_locations').select('latitude, longitude').eq('worker_id', workerId).maybeSingle()
    ]);

    const worker = workerRes.data;
    const liveLoc = liveLocRes.data;
    const current_lat = liveLoc ? Number(liveLoc.latitude) : worker?.current_lat;
    const current_lng = liveLoc ? Number(liveLoc.longitude) : worker?.current_lng;

    const nowIso = new Date().toISOString();

    // 2. Fetch active and expired manual offers
    const { data: offers, error: fetchErr } = await supabaseAdmin
      .from('manual_assignment_history')
      .select(`
        id,
        status,
        notes,
        expires_at,
        created_at,
        booking:bookings!inner (
          id,
          status,
          address_line,
          lat,
          lng,
          total_amount,
          scheduled_at,
          service_items (
            name
          )
        )
      `)
      .eq('worker_id', workerId)
      .in('status', ['ASSIGNED', 'EXPIRED'])
      .in('booking.status', ['MANUAL_ASSIGNMENT_REQUIRED', 'PENDING_ASSIGNMENT']);

    if (fetchErr) {
      throw fetchErr;
    }

    // 3. Map offers and calculate distance
    const activeOffers = (offers || []).map((o: any) => {
      let distance = 0.0;
      const b = o.booking;
      if (current_lat !== null && current_lng !== null && b?.lat !== null && b?.lng !== null) {
        distance = Number(calculateDistance(current_lat, current_lng, b.lat, b.lng).toFixed(2));
      }

      return {
        id: o.id,
        status: o.status,
        notes: o.notes,
        expiresAt: o.expires_at,
        createdAt: o.created_at,
        bookingId: b.id,
        serviceName: b.service_items?.name || 'Home Service',
        addressLine: b.address_line,
        scheduledAt: b.scheduled_at || b.created_at,
        distanceKm: distance,
        estimatedEarnings: Number((b.total_amount * 0.85).toFixed(2))
      };
    });

    return NextResponse.json({ success: true, offers: activeOffers }, { headers: cacheHeaders });

  } catch (error: any) {
    console.error('[Worker Offers API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}
