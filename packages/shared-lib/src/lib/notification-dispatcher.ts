import { supabaseAdmin } from './supabase-server';
import { sendPushNotification, sendBulkNotifications } from './firebase-notifications';

export interface DispatchNotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

export interface DispatchBulkNotificationPayload {
  userIds: string[];
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Single notification gateway.
 * Flow: Create DB Notification -> Send Push Notification -> Log Result
 */
export async function dispatchNotification(payload: DispatchNotificationPayload) {
  try {
    // 1. Create DB Notification
    const { error: dbErr } = await supabaseAdmin.from('notifications').insert({
      user_id: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {}
    });

    if (dbErr) {
      console.error('[Notification Dispatcher] DB Insert Failed:', dbErr);
      // We continue to push notification even if DB insert fails marginally
    }

    // 2. Send Push Notification (Non-blocking)
    // We don't await strictly to prevent blocking business logic, 
    // but in a serverless function we might need to await to ensure it fires.
    await sendPushNotification({
      userId: payload.userId,
      title: payload.title,
      body: payload.body,
      // Convert nested data to flat string map for FCM
      data: payload.data ? { payload: JSON.stringify(payload.data) } : undefined
    });

    return true;
  } catch (error) {
    console.error('[Notification Dispatcher] Error:', error);
    return false;
  }
}

/**
 * Single notification gateway for multiple users.
 * Flow: Create DB Notifications -> Send Bulk Push Notification -> Log Result
 */
export async function dispatchBulkNotifications(payload: DispatchBulkNotificationPayload) {
  try {
    if (payload.userIds.length === 0) return true;

    // 1. Create DB Notifications
    const inserts = payload.userIds.map(userId => ({
      user_id: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data || {}
    }));

    const { error: dbErr } = await supabaseAdmin.from('notifications').insert(inserts);

    if (dbErr) {
      console.error('[Notification Dispatcher] Bulk DB Insert Failed:', dbErr);
      throw new Error(`Database insert failed: ${dbErr.message}`);
    }

    // 2. Send Bulk Push Notification
    await sendBulkNotifications({
      userIds: payload.userIds,
      title: payload.title,
      body: payload.body,
      data: payload.data ? { payload: JSON.stringify(payload.data) } : undefined
    });

    return true;
  } catch (error) {
    console.error('[Notification Dispatcher] Bulk Error:', error);
    return false;
  }
}

/**
 * Filters out stale/mock notifications.
 * A notification is considered stale if it is a job offer/request but:
 * 1. The booking doesn't exist.
 * 2. The booking status is not PENDING_ASSIGNMENT or MANUAL_ASSIGNMENT_REQUIRED.
 * 3. The worker has already rejected the booking.
 */
export async function filterRealNotifications(notifications: any[], workerId: string): Promise<any[]> {
  if (!notifications || notifications.length === 0) return [];

  // Extract booking IDs from notifications data
  const bookingIds = notifications
    .map(n => n.data?.booking_id)
    .filter((id): id is string => typeof id === 'string');

  if (bookingIds.length === 0) return notifications;

  // Fetch all these bookings' statuses
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, status')
    .in('id', bookingIds);

  const bookingStatusMap = new Map(bookings?.map(b => [b.id, b.status]) || []);

  // Fetch any rejections by this worker for these bookings
  const { data: rejections } = await supabaseAdmin
    .from('worker_job_rejections')
    .select('booking_id')
    .eq('worker_id', workerId)
    .in('booking_id', bookingIds);

  const rejectedBookingIds = new Set(rejections?.map(r => r.booking_id) || []);

  return notifications.filter(n => {
    const bookingId = n.data?.booking_id;
    if (!bookingId) return true; // Keep system/non-booking notifications

    const status = bookingStatusMap.get(bookingId);
    if (!status) return false; // Filter out notifications for bookings that don't exist

    // If it's a booking request or manual assignment, booking must be in active status
    if (n.type === 'BOOKING_REQUEST' || n.type === 'MANUAL_ASSIGNMENT_CREATED') {
      if (status !== 'PENDING_ASSIGNMENT' && status !== 'MANUAL_ASSIGNMENT_REQUIRED') {
        return false;
      }
      // If the worker has already rejected this booking, filter it out
      if (rejectedBookingIds.has(bookingId)) {
        return false;
      }
    }

    return true;
  });
}

