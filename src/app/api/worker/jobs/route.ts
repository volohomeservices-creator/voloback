import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'new';

    // 1. Fetch worker location to calculate distance (prefer live location, fallback to profile coordinates)
    const [workerRes, liveLocRes] = await Promise.all([
      supabaseAdmin.from('workers').select('current_lat, current_lng, status').eq('id', workerId).single(),
      supabaseAdmin.from('worker_live_locations').select('latitude, longitude').eq('worker_id', workerId).maybeSingle()
    ]);

    if (workerRes.error || !workerRes.data) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
    }

    const liveLoc = liveLocRes.data;
    const current_lat = liveLoc ? Number(liveLoc.latitude) : workerRes.data.current_lat;
    const current_lng = liveLoc ? Number(liveLoc.longitude) : workerRes.data.current_lng;

    if (tab === 'new') {
      // Haversine function in Javascript
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

      // A. Fetch all rejections for this worker to exclude
      const { data: rejections } = await supabaseAdmin
        .from('worker_job_rejections')
        .select('booking_id')
        .eq('worker_id', workerId);
      
      const rejectedBookingIds = new Set((rejections || []).map(r => r.booking_id));

      // B. Fetch manually assigned bookings for this worker
      const { data: manuallyAssignedBookings, error: manualErr } = await supabaseAdmin
        .from('bookings')
        .select('*, service_items(name), customer:users!bookings_customer_id_fkey(full_name)')
        .eq('status', 'WORKER_ASSIGNED')
        .eq('worker_id', workerId);

      if (manualErr) throw manualErr;

      // C. Fetch all active broadcasting bookings
      const { data: broadcastingBookings, error: broadcastErr } = await supabaseAdmin
        .from('bookings')
        .select(`
          *,
          service_items(name),
          customer:users!bookings_customer_id_fkey(full_name),
          assignment_queue!inner(status, group_workers)
        `)
        .eq('status', 'PENDING_ASSIGNMENT')
        .eq('assignment_queue.status', 'BROADCASTING');

      if (broadcastErr) throw broadcastErr;

      // D. Filter broadcasting bookings in memory:
      // - Worker must be in the current group of the queue
      // - Worker must not have rejected this booking
      const eligibleBroadcastBookings = (broadcastingBookings || []).filter((b: any) => {
        if (rejectedBookingIds.has(b.id)) return false;

        const groupWorkers = b.assignment_queue?.group_workers || [];
        const isInGroup = groupWorkers.some((gw: any) => gw.worker_id === workerId);
        return isInGroup;
      });

      // E. Merge manually assigned and eligible broadcast bookings
      const mergedBookings = [
        ...(manuallyAssignedBookings || []),
        ...eligibleBroadcastBookings
      ];

      // F. Map and sort by distance
      const jobs = mergedBookings.map((b: any) => {
        let distance = 0.0;
        if (current_lat !== null && current_lng !== null && b.lat !== null && b.lng !== null) {
          distance = Number(calculateDistance(current_lat, current_lng, b.lat, b.lng).toFixed(1));
        }
        return {
          id: b.id,
          service_name: b.service_items?.name || 'Home Service',
          customer_first_name: b.customer?.full_name ? b.customer.full_name.split(' ')[0] : 'Client',
          locality: b.address_line ? b.address_line.split(',')[0] : 'Nearby',
          distance_km: distance,
          scheduled_at: b.scheduled_at || b.created_at,
          estimated_earnings: Number((b.total_amount * 0.85).toFixed(2)),
          status: b.status
        };
      })
      .sort((a, b) => a.distance_km - b.distance_km);

      return NextResponse.json({ jobs });

    } else if (tab === 'active') {
      const { data: bookings, error: bookingsErr } = await supabaseAdmin
        .from('bookings')
        .select('*, service_items(name), customer:users!bookings_customer_id_fkey(full_name)')
        .eq('worker_id', workerId)
        .in('status', ['WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS']);

      if (bookingsErr) throw bookingsErr;

      const jobs = (bookings || []).map((b: any) => ({
        id: b.id,
        service_name: b.service_items?.name || 'Home Service',
        customer_first_name: b.customer?.full_name ? b.customer.full_name.split(' ')[0] : 'Client',
        locality: b.address_line ? b.address_line.split(',')[0] : 'Nearby',
        scheduled_at: b.scheduled_at || b.created_at,
        status: b.status,
        estimated_earnings: Number((b.total_amount * 0.85).toFixed(2))
      }));

      return NextResponse.json({ jobs });

    } else {
      // Tab is history (completed and cancelled)
      const { data: bookings, error: bookingsErr } = await supabaseAdmin
        .from('bookings')
        .select('*, service_items(name), customer:users!bookings_customer_id_fkey(full_name)')
        .eq('worker_id', workerId)
        .in('status', ['COMPLETED', 'CANCELLED'])
        .order('created_at', { ascending: false })
        .limit(20);

      if (bookingsErr) throw bookingsErr;

      const jobs = (bookings || []).map((b: any) => ({
        id: b.id,
        service_name: b.service_items?.name || 'Home Service',
        customer_first_name: b.customer?.full_name ? b.customer.full_name.split(' ')[0] : 'Client',
        locality: b.address_line ? b.address_line.split(',')[0] : 'Nearby',
        scheduled_at: b.scheduled_at || b.created_at,
        status: b.status,
        estimated_earnings: Number((b.total_amount * 0.85).toFixed(2))
      }));

      return NextResponse.json({ jobs });
    }
  } catch (error: any) {
    console.error('Error fetching worker jobs:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
