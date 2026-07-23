import { bookingCreateSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { startAssignment } from '@/lib/assignment-engine';
import { dispatchNotification } from '@/lib/notification-dispatcher';
import { createOnlinePayment } from '@/lib/payment-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const customerId = session.user_id;

    // Fetch active bookings (not completed and not cancelled)
    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('*, service_items(name, description, base_price, estimated_mins), workers(users(full_name, phone))')
      .eq('customer_id', customerId)
      .not('status', 'in', '("COMPLETED","CANCELLED")')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ bookings: bookings || [] });
  } catch (error: any) {
    console.error('Error fetching customer active bookings:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const customerId = session.user_id;
    const validation = await validateBody(request, bookingCreateSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;

    const {
      service_item_id,
      address,
      latitude,
      longitude,
      scheduled_at,
      notes,
      payment_mode, // Extract payment_mode
      promo_code, // Extract optional promo code string
      images // array of storage paths in 'booking-images' bucket
    } = body;

    if (!service_item_id || !address || !latitude || !longitude) {
      return NextResponse.json({ error: 'Missing required booking fields.' }, { status: 400 });
    }

    // 1. Fetch service item to get base price
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('service_items')
      .select('*')
      .eq('id', service_item_id)
      .single();

    if (itemErr || !item) {
      return NextResponse.json({ error: 'Service item not found.' }, { status: 404 });
    }

    // 2. Calculate totals
    const basePrice = Number(item.base_price);
    const serviceFee = basePrice * 0.10;
    const tax = basePrice * 0.05;
    const totalAmount = basePrice + serviceFee + tax;

    // 2.5 Promo Code Verification
    let discountAmount = 0;
    let promo: any = null;

    if (promo_code) {
      const { data: promoRow, error: promoErr } = await supabaseAdmin
        .from('promo_codes')
        .select('*')
        .eq('code', promo_code.trim().toUpperCase())
        .eq('active', true)
        .single();

      if (promoErr || !promoRow) {
        return NextResponse.json({ error: 'Invalid or expired promo code.' }, { status: 400 });
      }

      promo = promoRow;

      // Check expiry
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return NextResponse.json({ error: 'This promo code has expired.' }, { status: 400 });
      }

      // Check valid_from
      if (promo.valid_from && new Date(promo.valid_from) > new Date()) {
        return NextResponse.json({ error: 'This promo code is not active yet.' }, { status: 400 });
      }

      // Check max_uses
      if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
        return NextResponse.json({ error: 'This promo code has reached its usage limit.' }, { status: 400 });
      }

      // Check role
      if (promo.applicable_role !== 'all' && promo.applicable_role !== session.role) {
        return NextResponse.json({ error: 'This promo code is not applicable for your account type.' }, { status: 400 });
      }

      // Check user usage
      const { data: existingUsage } = await supabaseAdmin
        .from('promo_code_usages')
        .select('id')
        .eq('promo_code_id', promo.id)
        .eq('user_id', customerId)
        .single();

      if (existingUsage) {
        return NextResponse.json({ error: 'You have already used this promo code.' }, { status: 400 });
      }

      // Check min order amount
      if (promo.min_order_amount && totalAmount < Number(promo.min_order_amount)) {
        return NextResponse.json({
          error: `Minimum order amount of ₹${promo.min_order_amount} required for this code.`,
        }, { status: 400 });
      }

      // Calculate discount
      if (promo.discount_type === 'FLAT') {
        discountAmount = Math.min(Number(promo.discount_value), totalAmount);
      } else {
        discountAmount = (totalAmount * Number(promo.discount_value)) / 100;
        if (promo.max_discount_amount) {
          discountAmount = Math.min(discountAmount, Number(promo.max_discount_amount));
        }
      }
      discountAmount = Math.round(discountAmount * 100) / 100;
    }

    const finalTotalAmount = Math.max(0, totalAmount - discountAmount);

    // 2.8 Wallet Balance Verification & Lock
    let wallet: any = null;
    if (payment_mode === 'WALLET') {
      const { data: walletRow, error: walletErr } = await supabaseAdmin
        .from('customer_wallets')
        .select('*')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (walletErr || !walletRow) {
        return NextResponse.json({ error: 'Volo Wallet not found.' }, { status: 400 });
      }

      if (Number(walletRow.balance) < finalTotalAmount) {
        return NextResponse.json({ error: 'Insufficient wallet balance.' }, { status: 400 });
      }

      wallet = walletRow;
    }

    // 3. Generate 4-digit start OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // 4. Determine booking type
    const bookingType = scheduled_at ? 'SCHEDULED' : 'INSTANT';
    const finalPaymentMode = (payment_mode === 'ONLINE' || payment_mode === 'WALLET') ? 'ONLINE' : 'COD';

    let lat = Number(latitude);
    let lng = Number(longitude);

    if (lat === 12.9716 && lng === 77.5946) {
      const geocodeResult = await geocodeAddress(address);
      if (geocodeResult) {
        lat = geocodeResult.lat;
        lng = geocodeResult.lng;
      }
    }

    // 5. Insert booking
    const { data: booking, error: insertErr } = await supabaseAdmin
      .from('bookings')
      .insert({
        customer_id: customerId,
        service_item_id,
        booking_type: bookingType,
        payment_mode: finalPaymentMode,
        status: 'PENDING_ASSIGNMENT',
        address_line: address,
        lat,
        lng,
        scheduled_at: scheduled_at ? new Date(scheduled_at).toISOString() : null,
        total_amount: finalTotalAmount,
        notes: notes || '',
        otp
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    // 5.5 Deduct from Wallet & Create Payment logs if WALLET
    if (payment_mode === 'WALLET' && wallet) {
      const newBalance = Number(wallet.balance) - finalTotalAmount;
      const { error: deductErr } = await supabaseAdmin
        .from('customer_wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('customer_id', customerId);

      if (deductErr) {
        console.error('Wallet deduction error:', deductErr);
        // Clean up or just throw (since we didn't run in transactional SQL block)
        throw new Error('Failed to complete wallet transaction deduction.');
      }

      // Record transaction
      const { error: txnErr } = await supabaseAdmin.from('customer_wallet_transactions').insert({
        customer_id: customerId,
        amount: finalTotalAmount,
        type: 'PAYMENT',
        description: `Payment for booking #${booking.id.substring(0, 8).toUpperCase()}`
      });
      if (txnErr) {
        console.error('Failed to insert customer wallet transaction log:', txnErr);
      }

      // Insert payment captured record
      const { data: payment, error: paymentErr } = await supabaseAdmin
        .from('payments')
        .insert({
          booking_id: booking.id,
          customer_id: customerId,
          payment_mode: 'ONLINE',
          status: 'SUCCESS',
          amount: finalTotalAmount,
          razorpay_order_id: 'wallet_pay',
          razorpay_payment_id: `wallet_tx_${Math.random().toString(36).substring(2, 10)}`,
          paid_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (paymentErr) {
        console.error('Failed to create payment record for wallet pay:', paymentErr);
      } else {
        await supabaseAdmin.from('payment_attempts').insert({
          payment_id: payment.id,
          status: 'CAPTURED',
          response: { wallet: true, amount: finalTotalAmount }
        });
      }
    }

    // 5.6 If ONLINE (not wallet), create mocked online payment
    if (payment_mode === 'ONLINE') {
      const paymentResult = await createOnlinePayment(booking.id, customerId, finalTotalAmount);
      if (!paymentResult.success) {
        console.error('Failed to create mock online payment:', paymentResult.error);
      }
    }

    // 5.7 Record Promo Usage & increment used count
    if (promo) {
      const { error: usageErr } = await supabaseAdmin
        .from('promo_code_usages')
        .insert({
          promo_code_id: promo.id,
          user_id: customerId,
          booking_id: booking.id,
          discount_applied: discountAmount
        });

      if (usageErr) {
        console.error('Warning: Failed to insert promo code usage row:', usageErr.message);
      }

      const { error: promoUpdateErr } = await supabaseAdmin
        .from('promo_codes')
        .update({ used_count: promo.used_count + 1 })
        .eq('id', promo.id);

      if (promoUpdateErr) {
        console.error('Warning: Failed to increment promo code used count:', promoUpdateErr.message);
      }
    }

    // 6. Insert booking image URLs if provided
    if (images && Array.isArray(images) && images.length > 0) {
      const imageRows = images.map((imgUrl: string) => ({
        booking_id: booking.id,
        image_url: imgUrl
      }));

      const { error: imgErr } = await supabaseAdmin
        .from('booking_images')
        .insert(imageRows);

      if (imgErr) {
        console.error('Warning: Failed to insert booking images mapping:', imgErr.message);
      }
    }

    // 7. Create notification
    await dispatchNotification({
      userId: customerId,
      type: 'BOOKING_CREATED',
      title: 'Booking Confirmed',
      body: `Your service request for ${item.name} is successfully registered.`
    });

    // Trigger auto-assignment immediately for both Instant and Scheduled bookings
    // so that the customer gets matched and confirmed with a worker ahead of time.
    startAssignment(booking.id).catch(err => {
      console.error('Assignment start failed:', err);
    });

    return NextResponse.json({
      success: true,
      bookingId: booking.id,
      message: 'Booking created successfully.'
    });
  } catch (error: any) {
    console.error('Error creating booking:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VoloHomeServices/1.0 (contact@volo.com)'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lng: lon };
      }
    }
  } catch (error) {
    console.error('Nominatim geocoding error:', error);
  }
  return null;
}

