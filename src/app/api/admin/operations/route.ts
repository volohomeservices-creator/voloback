import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { getAdminTrackingReport } from '@/lib/tracking/tracking-reporting';

export async function GET(request: Request) {
  try {
    // Verify admin access
    await requireRole(request, 'admin');

    // 1. Fetch active bookings (ACCEPTED, ON_THE_WAY, ARRIVED, IN_PROGRESS)
    const { data: activeBookings, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, status, address_line, lat, lng, worker_id, customer_id, total_amount, scheduled_at, service_items(name), workers(users(full_name))')
      .in('status', ['WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS']);

    if (bErr) throw bErr;

    // 2. Fetch all workers who are ONLINE or ON_JOB, joined with users and live locations
    const { data: activeWorkers, error: wErr } = await supabaseAdmin
      .from('workers')
      .select('id, status, rating, users(full_name, phone), worker_live_locations(latitude, longitude, accuracy, speed, heading, updated_at)')
      .in('status', ['ONLINE', 'ON_JOB']);

    if (wErr) throw wErr;

    // 3. Fetch service zones
    const { data: serviceZones, error: zErr } = await supabaseAdmin
      .from('service_zones')
      .select('*')
      .order('city_name', { ascending: true });

    if (zErr) throw zErr;

    // 4. Fetch admin tracking report KPIs
    const analytics = await getAdminTrackingReport();

    const workersList = (activeWorkers || []) as any[];
    const bookingsList = (activeBookings || []) as any[];

    // Map workers to custom categories
    const onlineWorkers = workersList.filter(w => w.status === 'ONLINE');
    const enRouteWorkers = workersList.filter(w => {
      // Find if they are on a booking with ON_THE_WAY status
      if (w.status !== 'ON_JOB') return false;
      const associatedBooking = bookingsList.find(b => b.worker_id === w.id);
      return associatedBooking?.status === 'ON_THE_WAY';
    });
    const onJobWorkers = workersList.filter(w => {
      if (w.status !== 'ON_JOB') return false;
      const associatedBooking = bookingsList.find(b => b.worker_id === w.id);
      return associatedBooking?.status === 'ARRIVED' || associatedBooking?.status === 'IN_PROGRESS' || associatedBooking?.status === 'WORKER_ACCEPTED';
    });

    return NextResponse.json({
      onlineWorkers,
      enRouteWorkers,
      onJobWorkers,
      activeBookings: activeBookings || [],
      serviceZones: serviceZones || [],
      analytics,
    });
  } catch (error: any) {
    console.error('[AdminOperationsAPI] Error fetching operational data:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

// Support updating service zones
export async function POST(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { city_name, zone_name, radius_km, active } = body;

    if (!city_name || !zone_name || radius_km === undefined) {
      return NextResponse.json({ error: 'city_name, zone_name, and radius_km are required' }, { status: 400 });
    }

    const { data: newZone, error } = await supabaseAdmin
      .from('service_zones')
      .insert({
        city_name,
        zone_name,
        radius_km: Number(radius_km),
        active: active !== undefined ? !!active : true,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, serviceZone: newZone });
  } catch (error: any) {
    console.error('[AdminOperationsAPI] Error creating service zone:', error.message || error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
