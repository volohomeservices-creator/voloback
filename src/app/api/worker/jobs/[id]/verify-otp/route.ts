import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { dispatchNotification } from '@/lib/notification-dispatcher';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { id } = await params;
    const { data: { otp }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!otp) {
      return NextResponse.json({ error: 'OTP is required.' }, { status: 400 });
    }

    // 1. Fetch booking row
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    }

    // 2. Validate worker owns this job
    if (booking.worker_id !== workerId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

    if (booking.status !== 'ARRIVED') {
      return NextResponse.json({ error: 'OTP verification is only allowed after marking arrived.' }, { status: 400 });
    }

    // 3. Verify OTP code
    if (booking.otp !== String(otp)) {
      return NextResponse.json({ error: 'Invalid OTP code. Please verify and submit again.' }, { status: 400 });
    }

    // 4. Update booking and worker statuses
    const { error: bookingUpdateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'IN_PROGRESS',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (bookingUpdateErr) throw bookingUpdateErr;

    const { error: workerUpdateErr } = await supabaseAdmin
      .from('workers')
      .update({
        status: 'ON_JOB',
        updated_at: new Date().toISOString()
      })
      .eq('id', workerId);

    if (workerUpdateErr) throw workerUpdateErr;

    // Notify customer
    await dispatchNotification({
      userId: booking.customer_id,
      type: 'JOB_STARTED',
      title: 'Service Started',
      body: 'OTP verified successfully. Your service has started.'
    });

    return NextResponse.json({
      success: true,
      message: 'OTP verified successfully. Journey status upgraded to WORK_STARTED.'
    });
  } catch (error: any) {
    console.error('Error verifying OTP:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
