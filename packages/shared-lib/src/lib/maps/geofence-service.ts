import { supabaseAdmin } from '../supabase-server';
import { getDistance } from '../haversine';
import { dispatchNotification } from '../notification-dispatcher';
import { logAuditAction } from '../audit';
import { AuditAction } from '@/types';

export async function checkBookingGeofences(
  bookingId: string,
  workerId: string,
  workerLat: number,
  workerLng: number,
  workerSpeed: number,
  customerLat: number,
  customerLng: number
): Promise<void> {
  try {
    const distanceKm = getDistance(workerLat, workerLng, customerLat, customerLng);

    // 1. WORKER_NEARBY (Distance <= 500m i.e., 0.5 km)
    if (distanceKm <= 0.5) {
      // Check if we've already sent a WORKER_NEARBY notification for this booking
      const { data: existingNotif, error: notifErr } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('user_id', await getCustomerUserId(bookingId))
        .eq('type', 'WORKER_NEARBY')
        .contains('data', { booking_id: bookingId })
        .limit(1)
        .maybeSingle();

      if (!existingNotif && !notifErr) {
        const customerUserId = await getCustomerUserId(bookingId);
        if (customerUserId) {
          await dispatchNotification({
            userId: customerUserId,
            type: 'WORKER_NEARBY',
            title: 'Technician is nearby!',
            body: 'Your technician is less than 500 meters away and will arrive shortly.',
            data: { booking_id: bookingId, worker_id: workerId },
          });
        }
      }
    }

    // 2. WORKER_ARRIVED (Distance <= 100m i.e., 0.1 km AND speed < 5 km/h AND maintained for 60 seconds)
    if (distanceKm <= 0.1 && workerSpeed < 5.0) {
      // Check if we've already recorded an ARRIVED event in booking_tracking_events
      const { data: existingEvent, error: eventErr } = await supabaseAdmin
        .from('booking_tracking_events')
        .select('id')
        .eq('booking_id', bookingId)
        .eq('event_type', 'ARRIVED')
        .limit(1)
        .maybeSingle();

      if (!existingEvent && !eventErr) {
        // Retrieve location history for this worker over the last 75 seconds to verify if maintained for 60 seconds
        const { data: history, error: historyErr } = await supabaseAdmin
          .from('worker_location_history')
          .select('latitude, longitude, speed, created_at')
          .eq('worker_id', workerId)
          .gte('created_at', new Date(Date.now() - 75 * 1000).toISOString())
          .order('created_at', { ascending: true });

        if (!historyErr && history && history.length > 1) {
          const oldestRecord = history[0];
          const newestRecord = history[history.length - 1];
          const timeSpanSec = (new Date(newestRecord.created_at).getTime() - new Date(oldestRecord.created_at).getTime()) / 1000;

          // If history spans at least 60 seconds, check if all records during this time satisfy the geofence rules
          if (timeSpanSec >= 60.0) {
            let allSatisfied = true;
            for (const record of history) {
              const recDist = getDistance(
                Number(record.latitude),
                Number(record.longitude),
                customerLat,
                customerLng
              );
              const recSpeed = Number(record.speed || 0);

              if (recDist > 0.1 || recSpeed >= 5.0) {
                allSatisfied = false;
                break;
              }
            }

            if (allSatisfied) {
              // Geofence condition met! Trigger events
              // a. Create tracking event
              await supabaseAdmin.from('booking_tracking_events').insert({
                booking_id: bookingId,
                worker_id: workerId,
                latitude: workerLat,
                longitude: workerLng,
                event_type: 'ARRIVED',
              });

              // b. Notify customer
              const customerUserId = await getCustomerUserId(bookingId);
              if (customerUserId) {
                await dispatchNotification({
                  userId: customerUserId,
                  type: 'WORKER_ARRIVED',
                  title: 'Technician Arrived',
                  body: 'Your technician has arrived at your location. Please share the OTP code to start the service.',
                  data: { booking_id: bookingId, worker_id: workerId },
                });
              }

              // c. Write audit log
              await logAuditAction({
                admin_id: workerId, // worker acts as the target admin/agent logging this
                action: AuditAction.WORKER_ARRIVED,
                target_type: 'booking',
                target_id: bookingId,
                metadata: { distance_km: distanceKm, speed: workerSpeed },
              });

              console.log(`[Geofence] Worker ${workerId} arrived at booking ${bookingId}`);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[GeofenceService] Error checking geofences:', error);
  }
}

async function getCustomerUserId(bookingId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single();

    if (error || !data) return null;
    return data.customer_id;
  } catch {
    return null;
  }
}
