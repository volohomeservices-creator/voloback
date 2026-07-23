import { supabaseAdmin } from '../supabase-server';

/**
 * Cleanup location intelligence history records based on retention policies:
 * - worker_live_locations: keep latest only (handled automatically by upsert)
 * - worker_location_history: keep 90 days
 * - booking_tracking_events: keep 180 days
 * - booking_route_snapshots: keep 180 days
 */
export async function runLocationRetentionCleanup(): Promise<{ success: boolean; deletedCount?: number }> {
  try {
    const now = new Date();
    
    const date90DaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const date180DaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();

    console.log('[LocationCleanup] Starting database retention cleanup...');

    // 1. worker_location_history (90 days)
    const { error: errHist } = await supabaseAdmin
      .from('worker_location_history')
      .delete()
      .lt('created_at', date90DaysAgo);

    if (errHist) throw errHist;

    // 2. booking_tracking_events (180 days)
    const { error: errEvents } = await supabaseAdmin
      .from('booking_tracking_events')
      .delete()
      .lt('created_at', date180DaysAgo);

    if (errEvents) throw errEvents;

    // 3. booking_route_snapshots (180 days)
    const { error: errSnaps } = await supabaseAdmin
      .from('booking_route_snapshots')
      .delete()
      .lt('captured_at', date180DaysAgo);

    if (errSnaps) throw errSnaps;

    console.log('[LocationCleanup] Cleanup finished successfully.');
    return { success: true };
  } catch (error: any) {
    console.error('[LocationCleanup] Retention cleanup failed:', error.message || error);
    return { success: false };
  }
}
