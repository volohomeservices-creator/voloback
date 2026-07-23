import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { filterRealNotifications } from '@/lib/notification-dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
    let session;
    try {
      session = await requireRole(request, 'worker');
    } catch (err: any) {
      if (err.status === 401) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
      throw err;
    }
    const workerId = session.user_id;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [
      workerRes,
      walletRes,
      profileRes,
      recentBookingsRes,
      totalCompletedRes,
      notificationsRes,
      liveLocRes
    ] = await Promise.all([
      supabaseAdmin.from('workers').select('status, kyc_status, current_lat, current_lng').eq('id', workerId).single(),
      supabaseAdmin.from('worker_wallets').select('balance').eq('worker_id', workerId).maybeSingle(),
      supabaseAdmin.from('worker_profiles').select('address, city, state, skills, experience, languages, bio').eq('worker_id', workerId).maybeSingle(),
      // Fetch only recent/active bookings for the dashboard instead of all-time history
      supabaseAdmin.from('bookings').select('id, status, scheduled_at, created_at, completed_at, total_amount')
        .eq('worker_id', workerId)
        .gte('created_at', thirtyDaysAgo),
      // Use a count query for all-time stats
      supabaseAdmin.from('bookings').select('id', { count: 'exact', head: true })
        .eq('worker_id', workerId)
        .eq('status', 'COMPLETED'),
      supabaseAdmin.from('notifications').select('id, user_id, title, body, created_at, is_read, data').eq('user_id', workerId).order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('worker_live_locations').select('latitude, longitude').eq('worker_id', workerId).maybeSingle()
    ]);

    if (workerRes.error || !workerRes.data) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404, headers: cacheHeaders });
    }

    // Fetch active broadcasting dispatches (optimized select fields)
    const [rejectionsRes, broadcastingRes] = await Promise.all([
      supabaseAdmin.from('worker_job_rejections').select('booking_id').eq('worker_id', workerId),
      supabaseAdmin.from('bookings').select(`
        id, status, total_amount, lat, lng, address_line, scheduled_at, created_at,
        service_items(name),
        customer:users!bookings_customer_id_fkey(full_name),
        assignment_queue!inner(status, group_workers, group_expires_at)
      `)
      .eq('status', 'PENDING_ASSIGNMENT')
      .eq('assignment_queue.status', 'BROADCASTING')
    ]);

    const worker = workerRes.data;
    const profile = (profileRes.data || {}) as any;
    const bookings = recentBookingsRes.data || [];
    const totalCompletedCount = totalCompletedRes.count || 0;
    const notificationsRaw = notificationsRes.data || [];
    const filteredNotifications = await filterRealNotifications(notificationsRaw, workerId);
    const notifications = filteredNotifications.slice(0, 5);

    // Fetch user details for profile completion
    const { data: user } = await supabaseAdmin.from('users').select('full_name, email, avatar_url').eq('id', workerId).single();

    // Calculate profile completion percentage
    let completedFields = 0;
    const totalFields = 10;

    if (user?.full_name) completedFields++;
    if (user?.email) completedFields++;
    if (user?.avatar_url) completedFields++;
    if (profile.address) completedFields++;
    if (profile.city) completedFields++;
    if (profile.state) completedFields++;
    if (profile.skills && profile.skills.length > 0) completedFields++;
    if (profile.experience !== undefined && profile.experience !== null) completedFields++;
    if (profile.languages && profile.languages.length > 0) completedFields++;
    if (profile.bio) completedFields++;

    const profileCompletion = Math.round((completedFields / totalFields) * 100);

    // Filter today's, completed, pending, upcoming jobs
    const today = new Date().toISOString().split('T')[0];
    
    const todayJobs = bookings.filter(b => b.created_at?.startsWith(today) || b.scheduled_at?.startsWith(today));
    const pendingJobs = bookings.filter(b => b.status === 'PENDING_ASSIGNMENT' || b.status === 'WORKER_ASSIGNED');
    const upcomingJobs = bookings.filter(b => b.status === 'WORKER_ACCEPTED' && b.scheduled_at && new Date(b.scheduled_at) > new Date());

    // Calculate worker payout share stats for dashboard
    const completedTodayBookings = bookings.filter(b => b.status === 'COMPLETED' && (b.completed_at?.startsWith(today) || b.created_at?.startsWith(today)));
    const completed_today = completedTodayBookings.length;
    const today_earnings = completedTodayBookings.reduce((sum, b) => sum + (Number(b.total_amount || 0) * 0.85), 0);

    // Fetch active job (WORKER_ACCEPTED, ON_THE_WAY, ARRIVED, IN_PROGRESS)
    const { data: activeJob } = await supabaseAdmin
      .from('bookings')
      .select('id, status, address_line, lat, lng, scheduled_at, service_items(name)')
      .eq('worker_id', workerId)
      .in('status', ['WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const formattedActiveJob = activeJob ? {
      id: activeJob.id,
      status: activeJob.status,
      address_line: activeJob.address_line,
      lat: activeJob.lat,
      lng: activeJob.lng,
      scheduled_at: activeJob.scheduled_at,
      service_name: (activeJob.service_items as any)?.name || 'Home Service'
    } : null;

    const liveLoc = liveLocRes.data;
    const current_lat = liveLoc ? Number(liveLoc.latitude) : worker.current_lat;
    const current_lng = liveLoc ? Number(liveLoc.longitude) : worker.current_lng;

    const rejectedBookingIds = new Set((rejectionsRes.data || []).map(r => r.booking_id));

    const eligibleBroadcastBookings = (broadcastingRes.data || []).filter((b: any) => {
      if (rejectedBookingIds.has(b.id)) return false;

      const groupWorkers = b.assignment_queue?.group_workers || [];
      const isInGroup = groupWorkers.some((gw: any) => gw.worker_id === workerId);
      return isInGroup;
    });

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

    const broadcastJobs = eligibleBroadcastBookings.map((b: any) => {
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
        status: b.status,
        expiresAt: b.assignment_queue?.group_expires_at
      };
    })
    .sort((a, b) => a.distance_km - b.distance_km);

    return NextResponse.json({
      profileCompletion,
      currentStatus: worker.status,
      kycStatus: worker.kyc_status,
      todayJobsCount: todayJobs.length,
      completedJobsCount: totalCompletedCount,
      pendingJobsCount: pendingJobs.length,
      upcomingJobs: upcomingJobs.slice(0, 5),
      commissionWalletBalance: Number(walletRes.data?.balance || 0),
      recentNotifications: notifications,
      activeJob: formattedActiveJob,
      broadcastJobs,
      stats: {
        today_earnings: Math.round(today_earnings),
        completed_today,
        rating: 4.8
      }
    }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching worker dashboard stats:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } }
    );
  }
}
