import { supabaseAdmin } from '../supabase-server';
import { getDistance } from '../haversine';
import { getDirections } from './directions-service';

export interface EtaResult {
  distanceKm: number;
  durationMin: number;
  source: 'google' | 'haversine' | 'cache';
}

export async function calculateBookingEta(
  bookingId: string,
  workerLat: number,
  workerLng: number,
  customerLat: number,
  customerLng: number
): Promise<EtaResult> {
  try {
    const now = new Date();
    const haversineDistance = getDistance(workerLat, workerLng, customerLat, customerLng);

    // 1. Fetch the last snapshot for this booking to check throttling/caching
    const { data: lastSnapshot, error: snapErr } = await supabaseAdmin
      .from('booking_route_snapshots')
      .select('*')
      .eq('booking_id', bookingId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastSnapshot) {
      const elapsedMs = now.getTime() - new Date(lastSnapshot.captured_at).getTime();
      const elapsedMinutes = elapsedMs / (1000 * 60);

      // Check distance worker moved since last snapshot
      const distanceMovedKm = getDistance(
        workerLat,
        workerLng,
        Number(lastSnapshot.worker_lat),
        Number(lastSnapshot.worker_lng)
      );

      // Throttling: if worker moved <= 200m (0.2km) AND elapsed time < 5 minutes, return cached snapshot
      if (distanceMovedKm <= 0.2 && elapsedMinutes < 5.0) {
        return {
          distanceKm: Number(lastSnapshot.distance_km),
          durationMin: Number(lastSnapshot.eta_minutes),
          source: 'cache',
        };
      }
    }

    let distanceKm = 0;
    let durationMin = 0;
    let source: 'google' | 'haversine' = 'haversine';

    // 2. Prioritize: Use Haversine if worker is > 3 km away to save Google API costs.
    // Only call Google Directions API if worker is within 3 km.
    if (haversineDistance <= 3.0) {
      console.log(`[EtaService] Worker is close (${haversineDistance.toFixed(2)} km). Querying Google Directions API...`);
      const route = await getDirections(
        { lat: workerLat, lng: workerLng },
        { lat: customerLat, lng: customerLng }
      );

      if (route) {
        distanceKm = route.distanceKm;
        durationMin = route.durationMin;
        source = 'google';
      } else {
        // Fallback to Haversine if API call fails
        distanceKm = haversineDistance;
        durationMin = Math.ceil((distanceKm / 25) * 60);
        source = 'haversine';
      }
    } else {
      // Use Haversine straight-line estimation
      distanceKm = haversineDistance;
      durationMin = Math.ceil((distanceKm / 25) * 60);
      source = 'haversine';
    }

    // Ensure values are numbers and formatted
    distanceKm = Number(distanceKm.toFixed(2));

    // 4. Store snapshot in database
    await supabaseAdmin.from('booking_route_snapshots').insert({
      booking_id: bookingId,
      distance_km: distanceKm,
      eta_minutes: durationMin,
      worker_lat: workerLat,
      worker_lng: workerLng,
      captured_at: now.toISOString(),
    });

    return {
      distanceKm,
      durationMin,
      source,
    };
  } catch (error) {
    console.error('[EtaService] Error calculating booking ETA:', error);
    // Absolute fallback in case of database or other failure
    const distanceKm = getDistance(workerLat, workerLng, customerLat, customerLng);
    const durationMin = Math.ceil((distanceKm / 25) * 60);
    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin,
      source: 'haversine',
    };
  }
}
