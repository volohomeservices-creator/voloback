import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { logAuditAction } from './audit';
import { dispatchNotification } from './notification-dispatcher';
import { AuditAction, NotificationType } from '@/types';
import { ManualAssignmentStatus } from '@/types/manual-assignment';

const SYSTEM_ADMIN_ID = 'ad8e7a68-b7eb-4b2a-8cfa-c529a65f9733';

/**
 * Creates a manual assignment offer for a worker.
 * Booking status remains MANUAL_ASSIGNMENT_REQUIRED.
 */
export async function createManualAssignmentOffer(
  bookingId: string,
  workerId: string,
  adminId: string,
  notes?: string
): Promise<string> {
  // 1. Verify worker eligibility
  const { data: worker, error: workerErr } = await supabaseAdmin
    .from('workers')
    .select('status, kyc_status, users!inner(is_active)')
    .eq('id', workerId)
    .single();

  if (workerErr || !worker) {
    throw new Error('Worker not found');
  }

  const workerUsers = worker.users as any;
  const isWorkerActive = Array.isArray(workerUsers) ? workerUsers[0]?.is_active : workerUsers?.is_active;
  if (!isWorkerActive) {
    throw new Error('Worker is suspended or inactive');
  }

  if (worker.kyc_status !== 'APPROVED') {
    throw new Error('Worker KYC is not approved');
  }

  if (worker.status === 'ON_JOB') {
    throw new Error('Worker is currently busy on another job');
  }

  if (worker.status !== 'ONLINE') {
    throw new Error('Worker is not online');
  }

  // 2. Verify booking status
  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from('bookings')
    .select('status')
    .eq('id', bookingId)
    .single();

  if (bookingErr || !booking) {
    throw new Error('Booking not found');
  }

  if (booking.status !== 'MANUAL_ASSIGNMENT_REQUIRED' && booking.status !== 'PENDING_ASSIGNMENT') {
    throw new Error(`Booking cannot be manually assigned in status ${booking.status}`);
  }

  // 3. Mark any existing active manual offers for this booking as REASSIGNED (with audit and notification logs)
  const { data: activeOffers } = await supabaseAdmin
    .from('manual_assignment_history')
    .select('id, worker_id')
    .eq('booking_id', bookingId)
    .eq('status', 'ASSIGNED');

  if (activeOffers && activeOffers.length > 0) {
    for (const activeOffer of activeOffers) {
      await supabaseAdmin
        .from('manual_assignment_history')
        .update({ status: 'REASSIGNED', updated_at: new Date().toISOString() })
        .eq('id', activeOffer.id);

      await dispatchNotification({
        userId: activeOffer.worker_id,
        type: 'MANUAL_ASSIGNMENT_REASSIGNED',
        title: 'Offer Reassigned',
        body: 'A direct job offer sent to you has been reassigned to another provider.',
        data: { booking_id: bookingId, offer_id: activeOffer.id }
      });

      await logAuditAction({
        admin_id: adminId,
        action: AuditAction.MANUAL_ASSIGNMENT_REASSIGNED,
        target_type: 'booking',
        target_id: bookingId,
        metadata: { offer_id: activeOffer.id, worker_id: activeOffer.worker_id }
      });
    }
  }

  // 4. Create new manual assignment offer (expires in 30 minutes)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: offer, error: insertErr } = await supabaseAdmin
    .from('manual_assignment_history')
    .insert({
      booking_id: bookingId,
      worker_id: workerId,
      assigned_by: adminId,
      status: 'ASSIGNED',
      notes: notes || null,
      expires_at: expiresAt
    })
    .select('id')
    .single();

  if (insertErr || !offer) {
    console.error('[Manual Assignment] Offer insertion failed:', insertErr);
    throw new Error('Failed to create manual assignment offer');
  }

  // 5. Create Notification for Worker
  await dispatchNotification({
    userId: workerId,
    type: 'MANUAL_ASSIGNMENT_CREATED',
    title: 'New Manual Job Offer',
    body: `You have received a direct job offer from the admin. Notes: ${notes || 'None'}`,
    data: { booking_id: bookingId, offer_id: offer.id }
  });

  // 6. Log Audit Action
  await logAuditAction({
    admin_id: adminId,
    action: AuditAction.MANUAL_ASSIGNMENT_CREATED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: { offer_id: offer.id, worker_id: workerId, notes }
  });

  return offer.id;
}

/**
 * Worker accepts manual assignment offer.
 * Booking status transitions to WORKER_ACCEPTED, worker status to ON_JOB.
 */
export async function acceptManualAssignmentOffer(
  offerId: string,
  workerId: string
): Promise<boolean> {
  // 1. Fetch manual offer
  const { data: offer, error: offerErr } = await supabaseAdmin
    .from('manual_assignment_history')
    .select('*')
    .eq('id', offerId)
    .single();

  if (offerErr || !offer) {
    throw new Error('Manual assignment offer not found');
  }

  if (offer.worker_id !== workerId) {
    throw new Error('Offer not assigned to this worker');
  }

  if (offer.status !== 'ASSIGNED') {
    throw new Error(`Offer is in status ${offer.status}, cannot be accepted`);
  }

  if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
    // Offer expired
    await supabaseAdmin
      .from('manual_assignment_history')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('id', offerId);
    throw new Error('Offer has expired');
  }

  // 1b. Validate Worker Eligibility (Update 9)
  const { data: worker, error: workerErr } = await supabaseAdmin
    .from('workers')
    .select('status, kyc_status, users!inner(is_active)')
    .eq('id', workerId)
    .single();

  if (workerErr || !worker) {
    throw new Error('Worker profile not found');
  }

  const workerUsers = worker.users as any;
  const isWorkerActive = Array.isArray(workerUsers) ? workerUsers[0]?.is_active : workerUsers?.is_active;
  if (!isWorkerActive) {
    throw new Error('Worker is suspended or inactive');
  }

  if (worker.kyc_status !== 'APPROVED') {
    throw new Error('Worker KYC is not approved');
  }

  if (worker.status === 'SUSPENDED') {
    throw new Error('Worker is suspended');
  }

  if (worker.status === 'ON_JOB') {
    throw new Error('Worker is currently busy on another job');
  }

  if (worker.status !== 'ONLINE') {
    throw new Error('Worker is not online');
  }

  const bookingId = offer.booking_id;

  // 2. Verify booking status
  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from('bookings')
    .select('status, customer_id, worker_id')
    .eq('id', bookingId)
    .single();

  if (bookingErr || !booking) {
    throw new Error('Booking not found');
  }

  if (booking.status !== 'MANUAL_ASSIGNMENT_REQUIRED' && booking.status !== 'PENDING_ASSIGNMENT') {
    throw new Error('Booking is no longer awaiting assignment');
  }

  if (booking.worker_id !== null) {
    throw new Error('Booking is already assigned to a worker');
  }

  // 4. Call auto_accept_booking RPC directly (FOR UPDATE lock) (Update 1)
  const { data: accepted, error: acceptErr } = await supabaseAdmin.rpc(
    'auto_accept_booking',
    {
      p_booking_id: bookingId,
      p_worker_id: workerId
    }
  );

  if (acceptErr || !accepted) {
    console.error('[Manual Assignment] auto_accept_booking RPC failed:', acceptErr?.message);
    return false;
  }

  // 5. Update Manual Assignment History Status = ACCEPTED
  await supabaseAdmin
    .from('manual_assignment_history')
    .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
    .eq('id', offerId);

  // 6. Update Queue Status = ASSIGNED
  await supabaseAdmin
    .from('assignment_queue')
    .update({
      status: 'ASSIGNED',
      assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('booking_id', bookingId);

  // 7. Create notification for Customer and Admins
  await Promise.all([
    dispatchNotification({
      userId: booking.customer_id,
      type: 'MANUAL_ASSIGNMENT_ACCEPTED',
      title: 'Technician Dispatched',
      body: 'Your manually assigned technician has accepted the order.'
    }),
    dispatchNotification({
      userId: offer.assigned_by,
      type: 'MANUAL_ASSIGNMENT_ACCEPTED',
      title: 'Manual Offer Accepted',
      body: `Worker accepted direct job offer for booking ${bookingId}.`
    })
  ]);

  // 8. Log Audit Action
  await logAuditAction({
    admin_id: offer.assigned_by,
    action: AuditAction.MANUAL_ASSIGNMENT_ACCEPTED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: { offer_id: offerId, worker_id: workerId }
  });

  return true;
}

/**
 * Worker rejects manual assignment offer.
 * Creates worker_job_rejections record.
 */
export async function rejectManualAssignmentOffer(
  offerId: string,
  workerId: string,
  reason?: string
): Promise<void> {
  // 1. Fetch manual offer
  const { data: offer, error: offerErr } = await supabaseAdmin
    .from('manual_assignment_history')
    .select('*')
    .eq('id', offerId)
    .single();

  if (offerErr || !offer) {
    throw new Error('Manual assignment offer not found');
  }

  if (offer.worker_id !== workerId) {
    throw new Error('Offer not assigned to this worker');
  }

  if (offer.status !== 'ASSIGNED') {
    throw new Error(`Offer is in status ${offer.status}, cannot be rejected`);
  }

  const bookingId = offer.booking_id;

  // 2. Update Manual Assignment History Status = REJECTED
  await supabaseAdmin
    .from('manual_assignment_history')
    .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
    .eq('id', offerId);

  // 3. Create rejection record in worker_job_rejections
  await supabaseAdmin
    .from('worker_job_rejections')
    .upsert({
      booking_id: bookingId,
      worker_id: workerId,
      reason: reason || 'MANUAL_OFFER_REJECTED'
    }, { onConflict: 'booking_id,worker_id' });

  // 4. Notify admin
  await dispatchNotification({
    userId: offer.assigned_by,
    type: 'MANUAL_ASSIGNMENT_REJECTED',
    title: 'Manual Offer Rejected',
    body: `Technician rejected your manual offer for booking ${bookingId}. Reason: ${reason || 'None'}`
  });

  // 5. Log Audit Action
  await logAuditAction({
    admin_id: SYSTEM_ADMIN_ID, // Sys logger
    action: AuditAction.MANUAL_ASSIGNMENT_REJECTED,
    target_type: 'booking',
    target_id: bookingId,
    metadata: { offer_id: offerId, worker_id: workerId, reason }
  });
}
