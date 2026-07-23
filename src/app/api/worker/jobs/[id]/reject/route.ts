import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { id } = await params;

    // 1. Fetch booking row
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    }

    // 2. Validate worker owns this assigned job OR is in the broadcast group
    if (booking.status === 'WORKER_ASSIGNED') {
      if (booking.worker_id !== workerId) {
        return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
      }

      // Check 5-minute assignment buffer for worker rejection
      const assignedAtTime = new Date(booking.updated_at).getTime();
      const elapsedMs = Date.now() - assignedAtTime;
      const bufferMs = 5 * 60 * 1000;

      if (elapsedMs > bufferMs) {
        return NextResponse.json({
          error: 'Rejection buffer expired. Assigned jobs can only be declined within 5 minutes of assignment.'
        }, { status: 400 });
      }

      // Revert manual assignment
      const { error: bookingUpdateErr } = await supabaseAdmin
        .from('bookings')
        .update({
          worker_id: null,
          status: 'PENDING_ASSIGNMENT',
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (bookingUpdateErr) throw bookingUpdateErr;

      const { error: workerUpdateErr } = await supabaseAdmin
        .from('workers')
        .update({
          status: 'ONLINE',
          updated_at: new Date().toISOString()
        })
        .eq('id', workerId);

      if (workerUpdateErr) throw workerUpdateErr;

      // Add to rejections
      const { rejectBooking } = await import('@/lib/assignment-engine');
      await rejectBooking(id, workerId, 'MANUAL_DECLINED_BY_WORKER');

      return NextResponse.json({ success: true, message: 'Job rejected.' });
    }

    if (booking.status === 'PENDING_ASSIGNMENT') {
      // Verify they are in the broadcast group
      const { data: queue } = await supabaseAdmin
        .from('assignment_queue')
        .select('all_notified_workers')
        .eq('booking_id', id)
        .single();

      const wasNotified = queue?.all_notified_workers?.includes(workerId);
      if (!wasNotified) {
        return NextResponse.json({ error: 'Access denied. Not in broadcast group.' }, { status: 403 });
      }

      // Add to rejections & advance group if all rejected
      const { rejectBooking } = await import('@/lib/assignment-engine');
      await rejectBooking(id, workerId, 'BROADCAST_DECLINED_BY_WORKER');

      return NextResponse.json({ success: true, message: 'Broadcast offer declined.' });
    }

    return NextResponse.json({ error: 'Only pending or assigned jobs can be rejected.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error rejecting job:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
