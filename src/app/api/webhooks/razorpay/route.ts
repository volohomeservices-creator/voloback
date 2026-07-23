import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase-server';
import { finalizeBookingFinancials } from '@/lib/payment-service';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || webhookSecret.includes('placeholder')) {
      logger.error('[Razorpay Webhook] Verification failed: RAZORPAY_WEBHOOK_SECRET is not configured or contains placeholders.');
      return NextResponse.json({ error: 'Webhook secret misconfiguration' }, { status: 500 });
    }

    if (!signature) {
      logger.warn('[Razorpay Webhook] Missing x-razorpay-signature header.');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      logger.warn('[Razorpay Webhook] Cryptographic signature mismatch. Rejecting webhook event.');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Process event data
    logger.info('[Razorpay Webhook] Event verified and received successfully', { event: payload?.event });

    if (payload?.event === 'payment.captured' || payload?.event === 'order.paid') {
      const paymentEntity = payload.payload?.payment?.entity;
      if (paymentEntity && paymentEntity.order_id) {
        const orderId = paymentEntity.order_id;
        const paymentId = paymentEntity.id;

        // ATOMIC Compare-and-Swap (CAS) lock.
        // Prevents Race Condition because Postgres updates are statement-level atomic.
        // Concurrent requests will affect 0 rows and gracefully exit.
        const { data: updatedPayment, error: updateError } = await supabaseAdmin
          .from('payments')
          .update({ 
            status: 'SUCCESS',
            razorpay_payment_id: paymentId,
            razorpay_signature: signature 
          })
          .eq('razorpay_order_id', orderId)
          .neq('status', 'SUCCESS')
          .select('id, booking_id')
          .single();

        if (updateError && updateError.code === 'PGRST116') {
          // Idempotent exit: already processed
          logger.info('[Razorpay Webhook] Payment already processed or not found, exiting idempotently.', { orderId });
          return NextResponse.json({ received: true, note: 'Already processed or invalid' }, { status: 200 });
        }

        if (updateError || !updatedPayment) {
          logger.error('[Razorpay Webhook] Database update failed:', updateError);
          return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
        }

        // Trigger settlement creation now that the payment is securely locked as SUCCESS
        await finalizeBookingFinancials(updatedPayment.booking_id);
      }
    }

    return NextResponse.json({ received: true, event: payload?.event }, { status: 200 });
  } catch (error: any) {
    logger.error('[Razorpay Webhook] Processing exception:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Razorpay webhook API active' });
}
