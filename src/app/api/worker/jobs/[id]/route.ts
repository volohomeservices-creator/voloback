import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { id } = await params;

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .select('*, service_items(*), customer:users!bookings_customer_id_fkey(*)')
      .eq('id', id)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404, headers: cacheHeaders });
    }

    // Security: Check that the worker is allowed to view this job (either assigned, accepted, in progress, or unassigned broadcasted)
    if (booking.worker_id !== null && booking.worker_id !== workerId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: cacheHeaders });
    }

    return NextResponse.json({
      id: booking.id,
      status: booking.status,
      booking_type: booking.booking_type,
      payment_mode: booking.payment_mode,
      address_line: booking.address_line,
      lat: booking.lat,
      lng: booking.lng,
      scheduled_at: booking.scheduled_at,
      started_at: booking.started_at,
      completed_at: booking.completed_at,
      created_at: booking.created_at,
      total_amount: Number(booking.total_amount),
      notes: booking.notes,
      estimated_earnings: Number((booking.total_amount * 0.85).toFixed(2)),
      service: booking.service_items,
      customer: {
        id: booking.customer?.id,
        full_name: booking.customer?.full_name,
        phone: booking.customer?.phone,
        email: booking.customer?.email
      }
    }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching job details:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}
