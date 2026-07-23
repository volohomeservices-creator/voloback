import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const customerId = session.user_id;

    // Fetch reviews left by this customer
    const { data: reviews, error } = await supabaseAdmin
      .from('reviews')
      .select('*, bookings(service_items(name)), workers(users(full_name))')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const formattedReviews = (reviews || []).map((r: any) => ({
      ...r,
      comment: r.review_text
    }));

    return NextResponse.json({ reviews: formattedReviews });
  } catch (error: any) {
    console.error('Error fetching reviews:', error.message || error);
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
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    const { booking_id, rating, comment } = body;

    if (!booking_id || !rating) {
      return NextResponse.json({ error: 'booking_id and rating (1-5) are required.' }, { status: 400 });
    }

    const ratingNum = Number(rating);
    if (ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
      return NextResponse.json({ error: 'Rating must be an integer between 1 and 5.' }, { status: 400 });
    }

    // 1. Fetch booking to ensure customer owns it, it is completed, and it has a worker_id
    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    if (bookingErr || !booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    }

    if (booking.customer_id !== customerId) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

    if (booking.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'Reviews can only be submitted for completed service requests.' }, { status: 400 });
    }

    if (!booking.worker_id) {
      return NextResponse.json({ error: 'No technician was assigned to this booking.' }, { status: 400 });
    }

    const workerId = booking.worker_id;

    // 2. Insert the review (using upsert/insert)
    // reviews table requires unique booking_id
    const { data: newReview, error: reviewErr } = await supabaseAdmin
      .from('reviews')
      .insert({
        booking_id,
        customer_id: customerId,
        worker_id: workerId,
        rating: ratingNum,
        review_text: comment || ''
      })
      .select('*')
      .single();

    if (reviewErr) {
      if (reviewErr.code === '23505') { // unique key violation
        return NextResponse.json({ error: 'You have already submitted a review for this booking.' }, { status: 400 });
      }
      throw reviewErr;
    }

    // 3. Recalculate average rating of worker
    const { data: allReviews, error: aggErr } = await supabaseAdmin
      .from('reviews')
      .select('rating')
      .eq('worker_id', workerId);

    if (!aggErr && allReviews && allReviews.length > 0) {
      const avgRating = allReviews.reduce((sum, r) => sum + Number(r.rating), 0) / allReviews.length;
      
      // Update workers rating
      await supabaseAdmin
        .from('workers')
        .update({ rating: parseFloat(avgRating.toFixed(2)) })
        .eq('id', workerId);
    }

    return NextResponse.json({
      success: true,
      review: newReview,
      message: 'Review submitted successfully.'
    });
  } catch (error: any) {
    console.error('Error submitting review:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
