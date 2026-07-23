import { bookingStatusUpdateSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { acceptBooking, rejectBooking } from '@/lib/assignment-engine';
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';
import { dispatchNotification } from '@/lib/notification-dispatcher';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { id } = await params;

    // Read the request body once
    const validation = await validateBody(request, bookingStatusUpdateSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;
    const { status, imageUrl } = body;

    // 1. Fetch the booking row
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    }

    // A. Handle REJECTED case
    if (status === 'REJECTED') {
      const reason = body.reason;
      await rejectBooking(id, workerId, reason);
      return NextResponse.json({ success: true });
    }

    // B. Handle ACCEPTED case
    if (status === 'ACCEPTED') {
      // Check if this booking was manually assigned to this worker
      if (booking.status === 'WORKER_ASSIGNED' && booking.worker_id === workerId) {
        // Transition booking status to WORKER_ACCEPTED
        const { error: bookingUpdateErr } = await supabaseAdmin
          .from('bookings')
          .update({
            status: 'WORKER_ACCEPTED',
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (bookingUpdateErr) throw bookingUpdateErr;

        // Clean up or update the assignment queue if it exists for this booking
        const { data: queue } = await supabaseAdmin
          .from('assignment_queue')
          .select('id, all_notified_workers')
          .eq('booking_id', id)
          .single();

        if (queue) {
          await supabaseAdmin
            .from('assignment_queue')
            .update({
              status: 'ASSIGNED',
              assigned_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', queue.id);

          // Mark job as taken for other notified workers to hide it from their list
          if (queue.all_notified_workers) {
            const otherWorkers = queue.all_notified_workers.filter((wId: string) => wId !== workerId);
            if (otherWorkers.length > 0) {
              const rejections = otherWorkers.map((wId: string) => ({
                booking_id: id,
                worker_id: wId,
                reason: 'JOB_TAKEN'
              }));
              await supabaseAdmin
                .from('worker_job_rejections')
                .upsert(rejections, { onConflict: 'booking_id,worker_id' });
            }
          }
        }

        // Notify customer
        await dispatchNotification({
          userId: booking.customer_id,
          type: 'BOOKING_ACCEPTED',
          title: 'Worker assigned',
          body: 'A worker has been assigned to your booking.',
          data: { booking_id: id, worker_id: workerId }
        });

        // Audit Log
        await logAuditAction({
          admin_id: workerId,
          action: AuditAction.ASSIGNMENT_ACCEPTED,
          target_type: 'booking',
          target_id: id,
          metadata: { booking_id: id, worker_id: workerId, manual: true }
        });

        return NextResponse.json({ success: true });
      }

      // Get queue record for this booking
      const { data: queue } = await supabaseAdmin
        .from('assignment_queue')
        .select('id, all_notified_workers, status')
        .eq('booking_id', id)
        .single();

      if (!queue || queue.status === 'ASSIGNED') {
        return NextResponse.json(
          { error: 'JOB_ALREADY_TAKEN' }, { status: 409 }
        );
      }

      // Verify this worker was actually notified for this job
      // (prevents workers accepting jobs they were never offered)
      const wasNotified = queue.all_notified_workers?.includes(workerId);
      if (!wasNotified) {
        return NextResponse.json(
          { error: 'NOT_IN_BROADCAST_GROUP' }, { status: 403 }
        );
      }

      const accepted = await acceptBooking(id, workerId, queue.id);
      if (!accepted) {
        return NextResponse.json(
          { error: 'JOB_ALREADY_TAKEN' }, { status: 409 }
        );
      }

      // Notify customer
      await dispatchNotification({
        userId: booking.customer_id,
        type: 'BOOKING_ACCEPTED',
        title: 'Worker assigned',
        body: 'A worker has been assigned to your booking.',
        data: { booking_id: id, worker_id: workerId }
      });

      return NextResponse.json({ success: true });
    }

    // 2. Validate worker owns this job (for other states like ON_THE_WAY, ARRIVED, COMPLETED)
    if (booking.status !== 'PENDING_ASSIGNMENT' && booking.worker_id !== workerId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

    const currentStatus = booking.status;
    let targetBookingStatus = '';
    let targetWorkerStatus = '';

    if (status === 'ON_THE_WAY') {
      if (currentStatus !== 'WORKER_ACCEPTED') {
        return NextResponse.json({ error: 'Cannot start journey yet.' }, { status: 400 });
      }
      targetBookingStatus = 'ON_THE_WAY';

    } else if (status === 'ARRIVED') {
      if (currentStatus !== 'ON_THE_WAY') {
        return NextResponse.json({ error: 'Cannot mark arrived yet.' }, { status: 400 });
      }
      targetBookingStatus = 'ARRIVED';

    } else if (status === 'COMPLETED') {
      if (currentStatus !== 'IN_PROGRESS') {
        return NextResponse.json({ error: 'Cannot complete work before it has started.' }, { status: 400 });
      }
      targetBookingStatus = 'COMPLETED';
      targetWorkerStatus = 'ONLINE';

    } else {
      return NextResponse.json({ error: 'Invalid status update request.' }, { status: 400 });
    }

    // 3. Perform database updates
    // Update booking status
    const updateData: any = {
      status: targetBookingStatus,
      updated_at: new Date().toISOString()
    };
    if (status === 'COMPLETED') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error: bookingUpdateErr } = await supabaseAdmin
      .from('bookings')
      .update(updateData)
      .eq('id', id);

    if (bookingUpdateErr) throw bookingUpdateErr;

    // Save job verification image
    if (status === 'COMPLETED' && imageUrl) {
      const { error: imgErr } = await supabaseAdmin
        .from('booking_images')
        .insert({
          booking_id: id,
          image_url: imageUrl
        });
      if (imgErr) {
        console.error('Failed to save completion image:', imgErr);
      }
    }

    // Update worker status if required
    if (targetWorkerStatus) {
      const { error: workerUpdateErr } = await supabaseAdmin
        .from('workers')
        .update({
          status: targetWorkerStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', workerId);

      if (workerUpdateErr) throw workerUpdateErr;
    }

    // Send customer notification
    let notificationTitle = '';
    let notificationBody = '';
    
    if (status === 'ON_THE_WAY') {
      notificationTitle = 'Technician En Route';
      notificationBody = 'Your technician is on the way to your location.';
    } else if (status === 'ARRIVED') {
      notificationTitle = 'Technician Arrived';
      notificationBody = 'Your technician has arrived. Share your OTP to begin the service.';
    } else if (status === 'COMPLETED') {
      notificationTitle = 'Service Request Completed';
      notificationBody = 'Your home service booking has been marked completed. Thank you!';
    }

    await dispatchNotification({
      userId: booking.customer_id,
      type: status === 'COMPLETED' ? 'JOB_COMPLETED' : 'WORKER_ARRIVING',
      title: notificationTitle,
      body: notificationBody
    });

    if (status === 'COMPLETED') {
      const { finalizeBookingFinancials } = await import('@/lib/payment-service');
      const financialsSuccess = await finalizeBookingFinancials(id);
      if (!financialsSuccess) {
        console.error(`Failed to finalize financials for booking ${id}`);
      }
    }

    return NextResponse.json({ success: true, status: targetBookingStatus });
  } catch (error: any) {
    console.error('Error updating job status:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
