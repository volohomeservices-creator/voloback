import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { dispatchNotification } from '@/lib/notification-dispatcher';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, 'admin');
    const { id: bookingId } = await params;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { reason, refund_to_wallet } = body;

    // Fetch booking
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select('id, status, customer_id, total_amount, worker_id')
      .eq('id', bookingId)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const nonCancellable = ['COMPLETED', 'CANCELLED'];
    if (nonCancellable.includes(booking.status)) {
      return NextResponse.json({ error: `Cannot cancel a booking with status ${booking.status}` }, { status: 400 });
    }

    // Cancel the booking
    const { error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateErr) throw updateErr;

    // Refund to wallet if requested
    if (refund_to_wallet && booking.customer_id && booking.total_amount) {
      const refundAmount = Number(booking.total_amount);
      // Upsert customer wallet balance
      const { data: existingWallet } = await supabaseAdmin
        .from('customer_wallets')
        .select('id, balance')
        .eq('customer_id', booking.customer_id)
        .maybeSingle();

      if (existingWallet) {
        await supabaseAdmin
          .from('customer_wallets')
          .update({ balance: Number(existingWallet.balance) + refundAmount })
          .eq('id', existingWallet.id);
      } else {
        await supabaseAdmin
          .from('customer_wallets')
          .insert({ customer_id: booking.customer_id, balance: refundAmount });
      }

      // Record transaction (best-effort, non-fatal)
      try {
        await supabaseAdmin.from('customer_wallet_transactions').insert({
          customer_id: booking.customer_id,
          amount: refundAmount,
          type: 'REFUND',
          description: `Refund for cancelled booking #${bookingId.substring(0, 8).toUpperCase()}`,
        });
      } catch (_) { /* non-fatal */ }
    }

    // Notify customer
    if (booking.customer_id) {
      await dispatchNotification({
        userId: booking.customer_id,
        type: 'BOOKING_CANCELLED',
        title: '📋 Booking Cancelled',
        body: refund_to_wallet
          ? `Your booking has been cancelled. ₹${booking.total_amount} has been refunded to your wallet.`
          : `Your booking has been cancelled by admin. ${reason ? 'Reason: ' + reason : ''}`,
        data: { booking_id: bookingId },
      });
    }

    // If worker was assigned, notify them too
    if (booking.worker_id) {
      await dispatchNotification({
        userId: booking.worker_id,
        type: 'BOOKING_CANCELLED',
        title: '📋 Booking Cancelled',
        body: 'A booking assigned to you has been cancelled by admin.',
        data: { booking_id: bookingId },
      });
    }

    return NextResponse.json({ success: true, refunded: !!refund_to_wallet });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
