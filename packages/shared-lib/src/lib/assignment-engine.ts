import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { logAuditAction } from './audit';
import { dispatchNotification, dispatchBulkNotifications } from './notification-dispatcher';
import { AuditAction, BookingStatus, AssignmentQueueWorker } from '@/types';

let cachedSystemAdminId: string | null = null;

async function getSystemAdminId(): Promise<string> {
  if (cachedSystemAdminId) return cachedSystemAdminId;
  
  if (process.env.SYSTEM_USER_ID) {
    cachedSystemAdminId = process.env.SYSTEM_USER_ID;
    return cachedSystemAdminId;
  }

  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (data && data.id) {
    cachedSystemAdminId = data.id;
    return cachedSystemAdminId as string;
  }

  return 'system-admin-fallback';
}

/**
 * Starts the assignment process for a given booking.
 * Excludes any rejectors, partitions eligible workers into groups,
 * and starts broadcasting to the first group.
 */
export async function startAssignment(bookingId: string): Promise<string> {
  console.log(`[Assignment Engine] Starting assignment for booking ${bookingId}`);

  // 1. Fetch booking by id
  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from('bookings')
    .select(`
      id,
      status,
      lat,
      lng,
      payment_mode,
      service_item_id,
      service_items (
        category_id
      )
    `)
    .eq('id', bookingId)
    .single();

  if (bookingErr || !booking) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  if (booking.status !== 'PENDING_ASSIGNMENT') {
    throw new Error(`Booking ${bookingId} is in status ${booking.status}, cannot start auto-assignment`);
  }

  const categoryId = (booking as any).service_items?.category_id || null;

  // 2. Get search radius from platform_settings
  const { data: radiusData } = await supabaseAdmin
    .from('platform_settings')
    .select('value')
    .eq('key', 'search_radius_km')
    .single();
  const radiusKm = radiusData ? parseFloat(radiusData.value) : 10;

  // 3. Find nearby eligible workers
  const { data: workers, error: rpcErr } = await supabaseAdmin.rpc(
    'find_nearby_eligible_workers',
    {
      p_lat: booking.lat,
      p_lng: booking.lng,
      p_radius_km: radiusKm,
      p_service_category_id: categoryId,
      p_booking_id: bookingId,
      p_payment_mode: booking.payment_mode
    }
  );

  if (rpcErr) {
    console.error('[Assignment Engine] Error finding nearby workers:', rpcErr);
    throw rpcErr;
  }

  const typedWorkers = (workers || []) as AssignmentQueueWorker[];

  // 4. If workers array is empty, transition booking to MANUAL_ASSIGNMENT_REQUIRED
  if (typedWorkers.length === 0) {
    console.log(`[Assignment Engine] No eligible workers found for booking ${bookingId}`);
    
    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'MANUAL_ASSIGNMENT_REQUIRED',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    // Notify admins
    const { data: admins } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('role', 'admin');

    if (admins && admins.length > 0) {
      const adminUserIds = admins.map(a => a.id);
      await dispatchBulkNotifications({
        userIds: adminUserIds,
        type: 'LOW_WALLET_BALANCE',
        title: 'Manual Assignment Required',
        body: `No eligible workers found nearby for booking ${bookingId}. Manual assignment is required.`,
        data: { booking_id: bookingId }
      });
    }

    await logAuditAction({
      admin_id: await getSystemAdminId(),
      action: AuditAction.ASSIGNMENT_MANUAL_REQUIRED,
      target_type: 'booking',
      target_id: bookingId,
      metadata: { booking_id: bookingId, reason: 'NO_WORKERS_FOUND' }
    });

    return 'NO_WORKERS';
  }

  // 5. Create groups from workers array - notify all nearby eligible workers at once
  const group1 = typedWorkers;

  // 6. Insert into assignment_queue
  const expiresAt = new Date(Date.now() + 180000).toISOString(); // 3m (180s)
  
  const { data: queue, error: queueErr } = await supabaseAdmin
    .from('assignment_queue')
    .upsert({
      booking_id: bookingId,
      current_group: 1,
      group_workers: group1,
      all_notified_workers: group1.map(w => w.worker_id),
      status: 'BROADCASTING',
      attempts: 1,
      group_expires_at: expiresAt,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'booking_id' })
    .select('id')
    .single();

  if (queueErr || !queue) {
    console.error('[Assignment Engine] Error inserting to queue:', queueErr);
    throw new Error('Failed to create assignment queue entry');
  }

  // 7. Broadcast to Group 1
  await broadcastToGroup(bookingId, group1);

  // 8. Log Audit
  await logAuditAction({
    admin_id: await getSystemAdminId(),
    action: AuditAction.ASSIGNMENT_STARTED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: {
      booking_id: bookingId,
      queue_id: queue.id,
      workers_found_count: typedWorkers.length,
      group1_count: group1.length
    }
  });

  return queue.id;
}

/**
 * Sends notifications to a group of workers.
 */
export async function broadcastToGroup(
  bookingId: string,
  workers: AssignmentQueueWorker[]
): Promise<void> {
  if (workers.length === 0) return;

  console.log(`[Assignment Engine] Broadcasting booking ${bookingId} to ${workers.length} workers`);

  const workerIds = workers.map(w => w.worker_id);

  const success = await dispatchBulkNotifications({
    userIds: workerIds,
    type: 'BOOKING_REQUEST',
    title: 'New job request',
    body: 'A new job is available near you.',
    data: { booking_id: bookingId }
  });

  if (!success) {
    console.error('[Assignment Engine] Failed to dispatch broadcast notifications');
  }

  await logAuditAction({
    admin_id: await getSystemAdminId(),
    action: AuditAction.ASSIGNMENT_BROADCAST,
    target_type: 'booking',
    target_id: bookingId,
    metadata: {
      booking_id: bookingId,
      worker_count: workers.length,
      worker_ids: workers.map(w => w.worker_id)
    }
  });
}

/**
 * Advances the queue to the next group, or marks it as failed if exhausted.
 */
export async function advanceAssignment(queueId: string): Promise<string> {
  console.log(`[Assignment Engine] Attempting to advance queue ${queueId}`);

  // 1. Call advance_assignment_queue RPC (SKIP LOCKED protection)
  const { data: lockResult, error: lockErr } = await supabaseAdmin.rpc(
    'advance_assignment_queue',
    { p_queue_id: queueId }
  );

  if (lockErr) {
    console.error('[Assignment Engine] Error calling advance RPC:', lockErr);
    return 'ERROR';
  }

  if (lockResult === 'SKIPPED') {
    console.log(`[Assignment Engine] Queue ${queueId} skipped: another process holds lock`);
    return 'SKIPPED';
  }

  if (lockResult === 'NOT_BROADCASTING') {
    console.log(`[Assignment Engine] Queue ${queueId} skipped: state is not BROADCASTING`);
    return 'NOT_BROADCASTING';
  }

  // 2. Fetch full queue record (status is now PROCESSING)
  const { data: queue, error: queueErr } = await supabaseAdmin
    .from('assignment_queue')
    .select('*')
    .eq('id', queueId)
    .single();

  if (queueErr || !queue) {
    console.error('[Assignment Engine] Failed to fetch queue after locking:', queueErr);
    return 'ERROR';
  }

  // 3. Verify linked booking is still PENDING_ASSIGNMENT
  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from('bookings')
    .select('status, lat, lng, payment_mode, service_items(category_id)')
    .eq('id', queue.booking_id)
    .single();

  if (bookingErr || !booking) {
    console.error('[Assignment Engine] Failed to fetch booking:', bookingErr);
    await supabaseAdmin
      .from('assignment_queue')
      .update({ status: 'FAILED', updated_at: new Date().toISOString() })
      .eq('id', queueId);
    return 'BOOKING_NOT_FOUND';
  }

  if (booking.status !== 'PENDING_ASSIGNMENT') {
    console.log(`[Assignment Engine] Booking ${queue.booking_id} status is ${booking.status}. Marking queue ASSIGNED.`);
    await supabaseAdmin
      .from('assignment_queue')
      .update({ status: 'ASSIGNED', assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', queueId);
    return 'ALREADY_ASSIGNED';
  }

  // 4. If current_group < 3, calculate next group and advance
  if (queue.current_group < 3) {
    const nextGroup = (queue.current_group + 1) as 1 | 2 | 3;

    // Get search radius
    const { data: radiusData } = await supabaseAdmin
      .from('platform_settings')
      .select('value')
      .eq('key', 'search_radius_km')
      .single();
    const radiusKm = radiusData ? parseFloat(radiusData.value) : 10;
    const categoryId = (booking as any).service_items?.category_id || null;

    // Query nearby eligible workers again
    const { data: workers } = await supabaseAdmin.rpc(
      'find_nearby_eligible_workers',
      {
        p_lat: booking.lat,
        p_lng: booking.lng,
        p_radius_km: radiusKm,
        p_service_category_id: categoryId,
        p_booking_id: queue.booking_id,
        p_payment_mode: booking.payment_mode
      }
    );

    const typedWorkers = (workers || []) as AssignmentQueueWorker[];
    const notifiedSet = new Set<string>(queue.all_notified_workers || []);

    // Loop through groups until we find workers to notify
    let checkGroup = nextGroup;
    let checkGroupWorkers: AssignmentQueueWorker[] = [];

    while (checkGroup <= 3) {
      // Notify all currently eligible workers who haven't been notified yet
      let rawGroupWorkers = typedWorkers;
      
      checkGroupWorkers = rawGroupWorkers.filter(w => !notifiedSet.has(w.worker_id));
      if (checkGroupWorkers.length > 0) {
        break;
      }
      checkGroup++;
    }

    if (checkGroup <= 3 && checkGroupWorkers.length > 0) {
      const newAllNotified = [...(queue.all_notified_workers || []), ...checkGroupWorkers.map(w => w.worker_id)];
      const expiresAt = new Date(Date.now() + 180000).toISOString(); // 3m (180s)

      await supabaseAdmin
        .from('assignment_queue')
        .update({
          current_group: checkGroup,
          group_workers: checkGroupWorkers,
          all_notified_workers: newAllNotified,
          status: 'BROADCASTING',
          attempts: queue.attempts + 1,
          group_expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', queueId);

      await broadcastToGroup(queue.booking_id, checkGroupWorkers);
      return 'ADVANCED';
    }
  }

  // 5. If current_group was 3, or if no workers found in subsequent groups
  console.log(`[Assignment Engine] All groups exhausted for booking ${queue.booking_id}. Reverting to manual assignment.`);

  await supabaseAdmin
    .from('assignment_queue')
    .update({
      status: 'FAILED',
      updated_at: new Date().toISOString()
    })
    .eq('id', queueId);

  await supabaseAdmin
    .from('bookings')
    .update({
      status: 'MANUAL_ASSIGNMENT_REQUIRED',
      updated_at: new Date().toISOString()
    })
    .eq('id', queue.booking_id);

  // Notify admins
  const { data: admins } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'admin');

  if (admins && admins.length > 0) {
    const adminUserIds = admins.map(a => a.id);
    await dispatchBulkNotifications({
      userIds: adminUserIds,
      type: 'LOW_WALLET_BALANCE',
      title: 'Manual Assignment Required',
      body: `Auto assignment failed for booking ${queue.booking_id}. Manual intervention is required.`,
      data: { booking_id: queue.booking_id }
    });
  }

  await logAuditAction({
    admin_id: await getSystemAdminId(),
    action: AuditAction.ASSIGNMENT_MANUAL_REQUIRED,
    target_type: 'booking',
    target_id: queue.booking_id,
    metadata: { booking_id: queue.booking_id }
  });

  return 'MANUAL_REQUIRED';
}

/**
 * Assigns booking to a worker and marks the queue entry as completed.
 */
export async function acceptBooking(
  bookingId: string,
  workerId: string,
  queueId: string
): Promise<boolean> {
  console.log(`[Assignment Engine] Worker ${workerId} accepting booking ${bookingId}`);

  // 1. Call auto_accept_booking RPC (FOR UPDATE row lock)
  const { data: accepted, error: acceptErr } = await supabaseAdmin.rpc(
    'auto_accept_booking',
    {
      p_booking_id: bookingId,
      p_worker_id: workerId
    }
  );

  if (acceptErr || !accepted) {
    console.log(`[Assignment Engine] Accept failed for booking ${bookingId} by worker ${workerId}:`, acceptErr?.message);
    return false;
  }

  // 2. Update assignment_queue
  await supabaseAdmin
    .from('assignment_queue')
    .update({
      status: 'ASSIGNED',
      assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', queueId);

  // 3. Mark job as taken for other notified workers to hide it
  const { data: queue } = await supabaseAdmin
    .from('assignment_queue')
    .select('all_notified_workers')
    .eq('id', queueId)
    .single();

  if (queue && queue.all_notified_workers) {
    const otherWorkers = queue.all_notified_workers.filter((id: string) => id !== workerId);
    if (otherWorkers.length > 0) {
      const rejections = otherWorkers.map((wId: string) => ({
        booking_id: bookingId,
        worker_id: wId,
        reason: 'JOB_TAKEN'
      }));
      
      await supabaseAdmin
        .from('worker_job_rejections')
        .upsert(rejections, { onConflict: 'booking_id,worker_id' });
    }
  }

  // 4. Audit Log
  await logAuditAction({
    admin_id: await getSystemAdminId(),
    action: AuditAction.ASSIGNMENT_ACCEPTED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: { booking_id: bookingId, worker_id: workerId }
  });

  return true;
}

/**
 * Records a worker's job rejection. If all workers in the current broadcast
 * group reject the job, advances the queue immediately.
 */
export async function rejectBooking(
  bookingId: string,
  workerId: string,
  reason?: string
): Promise<void> {
  console.log(`[Assignment Engine] Worker ${workerId} rejecting booking ${bookingId}`);

  // 1. Insert into rejections
  await supabaseAdmin
    .from('worker_job_rejections')
    .upsert({
      booking_id: bookingId,
      worker_id: workerId,
      reason: reason || null
    }, { onConflict: 'booking_id,worker_id' });

  // 1.5 Check if worker has rejected more than 5 requests (excluding JOB_TAKEN auto-rejections)
  const { count: explicitRejectionsCount } = await supabaseAdmin
    .from('worker_job_rejections')
    .select('*', { count: 'exact', head: true })
    .eq('worker_id', workerId)
    .neq('reason', 'JOB_TAKEN');

  if (explicitRejectionsCount !== null && explicitRejectionsCount > 5) {
    // Check if worker is currently actively on job
    const { data: worker } = await supabaseAdmin
      .from('workers')
      .select('status')
      .eq('id', workerId)
      .single();

    if (worker && worker.status !== 'ON_JOB') {
      console.log(`[Assignment Engine] Worker ${workerId} has explicitly rejected ${explicitRejectionsCount} orders. Automatically suspending account.`);
      
      // Suspend in users table
      await supabaseAdmin
        .from('users')
        .update({ is_suspended: true, updated_at: new Date().toISOString() })
        .eq('id', workerId);

      // Suspend in workers table
      await supabaseAdmin
        .from('workers')
        .update({ status: 'SUSPENDED', updated_at: new Date().toISOString() })
        .eq('id', workerId);

      // Notify worker
      await dispatchNotification({
        userId: workerId,
        type: 'LOW_WALLET_BALANCE',
        title: 'Account Suspended',
        body: 'Your account is suspended due to excessive booking rejections. Contact Super Admin to release.'
      }).catch(err => console.error('Failed to notify worker of suspension:', err));

      // Audit Log
      await logAuditAction({
        admin_id: await getSystemAdminId(),
        action: AuditAction.WORKER_SUSPENDED,
        target_type: 'worker',
        target_id: workerId,
        metadata: {
          worker_id: workerId,
          reason: 'AUTO_SUSPEND_EXCESSIVE_REJECTIONS',
          rejection_count: explicitRejectionsCount
        }
      });
    }
  }

  // 2. Fetch active BROADCASTING queue
  const { data: queue } = await supabaseAdmin
    .from('assignment_queue')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('status', 'BROADCASTING')
    .single();

  if (queue) {
    // 3. Fetch count of rejections by current group workers
    const groupWorkerIds = (queue.group_workers || []).map((w: any) => w.worker_id);
    
    if (groupWorkerIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('worker_job_rejections')
        .select('*', { count: 'exact', head: true })
        .eq('booking_id', bookingId)
        .in('worker_id', groupWorkerIds);

      // If everyone in this group rejected, advance immediately
      if (count === groupWorkerIds.length) {
        console.log(`[Assignment Engine] All workers in current group rejected booking ${bookingId}. Advancing queue immediately.`);
        advanceAssignment(queue.id).catch(err => {
          console.error('[Assignment Engine] Immediate advance failed:', err);
        });
      }
    }
  }

  // 4. Audit Log
  await logAuditAction({
    admin_id: await getSystemAdminId(),
    action: AuditAction.ASSIGNMENT_REJECTED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: { booking_id: bookingId, worker_id: workerId, reason }
  });
}
