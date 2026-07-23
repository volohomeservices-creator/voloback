import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { RankingCandidate } from '@/types/manual-assignment';

export async function getManualAssignmentCandidates(bookingId: string): Promise<RankingCandidate[]> {
  try {
    // 1. Fetch booking location details
    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select('lat, lng, service_item_id, payment_mode, service_items(category_id)')
      .eq('id', bookingId)
      .single();

    if (bookingErr || !booking) {
      console.error(`[Ranking Engine] Booking ${bookingId} not found:`, bookingErr);
      return [];
    }

    const categoryId = (booking as any).service_items?.category_id || null;

    // 2. Fetch search radius from platform_settings
    const { data: radiusData } = await supabaseAdmin
      .from('platform_settings')
      .select('value')
      .eq('key', 'search_radius_km')
      .single();
    // Default to 25km if not set, since this is manual assignment which allows wider search
    const radiusKm = radiusData ? parseFloat(radiusData.value) : 25;

    // 3. Find nearby eligible workers using RPC
    let { data: nearbyWorkers, error: rpcErr } = await supabaseAdmin.rpc(
      'find_nearby_eligible_workers',
      {
        p_lat: booking.lat,
        p_lng: booking.lng,
        p_radius_km: radiusKm,
        p_service_category_id: categoryId,
        p_booking_id: bookingId,
        p_payment_mode: 'ONLINE' // Manual assignment overrides COD wallet balance check
      }
    );

    if (rpcErr) {
      console.error(`[Ranking Engine] Error calling find_nearby_eligible_workers for booking ${bookingId}:`, rpcErr);
    }

    // If no workers match the specific category, fall back to any category workers nearby
    if ((rpcErr || !nearbyWorkers || nearbyWorkers.length === 0) && categoryId) {
      console.log(`[Ranking Engine] No specific category workers found near booking ${bookingId}. Falling back to any category...`);
      const fallbackResult = await supabaseAdmin.rpc(
        'find_nearby_eligible_workers',
        {
          p_lat: booking.lat,
          p_lng: booking.lng,
          p_radius_km: radiusKm,
          p_service_category_id: null,
          p_booking_id: bookingId,
          p_payment_mode: 'ONLINE' // Manual assignment overrides COD wallet balance check
        }
      );
      if (fallbackResult.error) {
        console.error(`[Ranking Engine] Fallback find_nearby_eligible_workers error:`, fallbackResult.error);
      } else if (fallbackResult.data) {
        nearbyWorkers = fallbackResult.data;
      }
    }

    if (!nearbyWorkers || nearbyWorkers.length === 0) {
      console.log(`[Ranking Engine] No eligible workers found near booking ${bookingId}`);
      return [];
    }


    const workerIds = nearbyWorkers.map((nw: any) => nw.worker_id);

    // 4. Fetch worker profiles and availability
    const { data: workerProfiles, error: fetchErr } = await supabaseAdmin
      .from('workers')
      .select(`
        id,
        rating,
        total_jobs,
        status,
        kyc_status,
        commission_wallet_balance,
        users!inner (
          full_name,
          phone,
          is_active
        ),
        worker_availability (
          working_days,
          start_time,
          end_time,
          vacation_mode,
          unavailable_dates
        )
      `)
      .in('id', workerIds);

    if (fetchErr || !workerProfiles) {
      console.error('[Ranking Engine] Error fetching worker profiles:', fetchErr);
      return [];
    }

    // 5. Fetch manual assignment history for the workers to compute acceptance rate
    const { data: assignmentHistory, error: historyErr } = await supabaseAdmin
      .from('manual_assignment_history')
      .select('worker_id, status')
      .in('worker_id', workerIds);

    if (historyErr) {
      console.error('[Ranking Engine] Error fetching assignment history:', historyErr);
    }

    // 6. Calculate scores and map candidate records
    const candidates: RankingCandidate[] = workerProfiles.map((w: any) => {
      const distanceObj = nearbyWorkers.find((nw: any) => nw.worker_id === w.id);
      const distance = distanceObj ? distanceObj.distance_km : radiusKm;

      // Filter history for this worker
      const workerHistory = (assignmentHistory || []).filter((h: any) => h.worker_id === w.id);
      const totalOffers = workerHistory.length;
      const acceptedOffers = workerHistory.filter((h: any) => h.status === 'ACCEPTED').length;
      
      const acceptanceRate = totalOffers > 0 ? acceptedOffers / totalOffers : 1.0; // Default to 100% acceptance for new providers

      // Calculate component scores out of 100
      const distScore = Math.max(0, Math.min(100, (1 - (distance / radiusKm)) * 100));
      const ratingScore = Math.max(0, Math.min(100, (Number(w.rating || 0) / 5) * 100));
      const jobsScore = Math.max(0, Math.min(100, (Number(w.total_jobs || 0) / 50.0) * 100));
      const acceptanceScore = acceptanceRate * 100;

      // Compute weighted sum
      // Distance = 40%, Rating = 30%, Completed Jobs = 20%, Acceptance Rate = 10%
      const totalScore = (distScore * 0.4) + (ratingScore * 0.3) + (jobsScore * 0.2) + (acceptanceScore * 0.1);

      return {
        workerId: w.id,
        name: w.users?.full_name || 'Service Professional',
        phone: w.users?.phone || '',
        score: Number(totalScore.toFixed(1)),
        distance: Number(distance.toFixed(2)),
        rating: Number(w.rating || 0),
        jobs: w.total_jobs || 0,
        acceptanceRate: Number((acceptanceRate * 100).toFixed(0)),
        status: w.status,
        kycStatus: w.kyc_status,
        availability: w.worker_availability ? {
          working_days: w.worker_availability.working_days || [],
          start_time: w.worker_availability.start_time || '09:00:00',
          end_time: w.worker_availability.end_time || '18:00:00',
          vacation_mode: !!w.worker_availability.vacation_mode,
          unavailable_dates: w.worker_availability.unavailable_dates || []
        } : null
      };
    });

    // Sort descending by score
    return candidates.sort((a, b) => b.score - a.score);

  } catch (error) {
    console.error('[Ranking Engine] Exception during candidate ranking:', error);
    return [];
  }
}
