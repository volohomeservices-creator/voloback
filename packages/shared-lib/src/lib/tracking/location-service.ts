import { supabaseAdmin } from '../supabase-server';
import { calculateBookingEta } from '../maps/eta-service';
import { checkBookingGeofences } from '../maps/geofence-service';

export interface LocationUpdatePayload {
  workerId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  deviceType: 'WEB' | 'ANDROID' | 'IOS';
}

export async function processWorkerLocationUpdate(payload: LocationUpdatePayload): Promise<{ success: boolean; activeBookingId?: string }> {
  const { workerId, latitude, longitude, accuracy, speed, heading, deviceType } = payload;

  try {
    // 1. Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Invalid coordinates range.');
    }

    // 2. Check worker status - ignore location updates if OFFLINE or VACATION
    const { data: worker, error: workerErr } = await supabaseAdmin
      .from('workers')
      .select('status')
      .eq('id', workerId)
      .single();

    if (workerErr || !worker) {
      throw new Error('Worker not found.');
    }

    if (worker.status === 'OFFLINE' || worker.status === 'VACATION') {
      // Ignore location update silently
      return { success: false };
    }

    const now = new Date().toISOString();

    // 3. Upsert into worker_live_locations (source of truth)
    const { error: liveErr } = await supabaseAdmin
      .from('worker_live_locations')
      .upsert(
        {
          worker_id: workerId,
          latitude,
          longitude,
          accuracy: accuracy || null,
          speed: speed || null,
          heading: heading || null,
          device_type: deviceType,
          updated_at: now,
        },
        { onConflict: 'worker_id' }
      );

    if (liveErr) {
      throw liveErr;
    }

    // 4. Insert into worker_location_history
    const { error: histErr } = await supabaseAdmin.from('worker_location_history').insert({
      worker_id: workerId,
      latitude,
      longitude,
      accuracy: accuracy || null,
      speed: speed || null,
      heading: heading || null,
      created_at: now,
    });

    if (histErr) {
      console.error('[LocationService] History logging failed:', histErr.message);
    }

    // 5. Look for active bookings for this worker
    // Active statuses where tracking and geofencing should run
    const { data: activeBooking, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select('id, lat, lng, status')
      .eq('worker_id', workerId)
      .in('status', ['WORKER_ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bookingErr) {
      console.error('[LocationService] Error searching active bookings:', bookingErr);
    }

    if (activeBooking) {
      // 6. Trigger Geofencing & ETA checks
      const speedVal = speed || 0;

      // Fetch the latest snapshot to evaluate throttling rules
      const { data: latestSnapshot } = await supabaseAdmin
        .from('booking_route_snapshots')
        .select('captured_at, worker_lat, worker_lng')
        .eq('booking_id', activeBooking.id)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let shouldUpdateEta = true;
      if (latestSnapshot) {
        const lastTime = new Date(latestSnapshot.captured_at).getTime();
        const timeElapsedMs = Date.now() - lastTime;
        
        // Approximate distance displacement in meters using direct coordinate delta
        const latDiff = latitude - Number(latestSnapshot.worker_lat);
        const lngDiff = longitude - Number(latestSnapshot.worker_lng);
        const displacementMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000;

        // Throttle check: update at most once every 3 minutes (180,000ms) or if displacement > 200 meters
        if (timeElapsedMs < 180 * 1000 && displacementMeters < 200) {
          shouldUpdateEta = false;
        }
      }

      if (shouldUpdateEta) {
        // Recalculate ETA and store route snapshot
        await calculateBookingEta(
          activeBooking.id,
          latitude,
          longitude,
          Number(activeBooking.lat),
          Number(activeBooking.lng)
        );
      }

      // Run geofencing checks (Arrival rules / Nearby notification triggers)
      await checkBookingGeofences(
        activeBooking.id,
        workerId,
        latitude,
        longitude,
        speedVal,
        Number(activeBooking.lat),
        Number(activeBooking.lng)
      );

      return { success: true, activeBookingId: activeBooking.id };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[LocationService] Location update processing exception:', error.message || error);
    return { success: false };
  }
}
