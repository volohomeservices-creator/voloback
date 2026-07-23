import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '15');
    const search = searchParams.get('search') || '';
    
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('reviews')
      .select(`
        id,
        rating,
        comment:review_text,
        is_hidden,
        created_at,
        booking_id,
        bookings (id, service_items(name)),
        customer:customer_id (id, full_name, phone),
        worker:worker_id (id, users(full_name, phone))
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Note: To implement text search properly we would ideally join and filter, 
    // but for now, we'll return all or just use basic filters if provided.
    // E.g., if worker ID is provided, filter by it.
    const workerId = searchParams.get('worker_id');
    if (workerId) {
      query = query.eq('worker_id', workerId);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    // Map data to a flat structure if needed
    const formattedData = data.map((row: any) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      is_hidden: row.is_hidden,
      created_at: row.created_at,
      booking_id: row.booking_id,
      service_name: row.bookings?.service_items?.name,
      customer_name: row.customer?.full_name,
      worker_name: row.worker?.users?.full_name,
    }));

    return NextResponse.json({
      reviews: formattedData,
      total: count || 0,
      page,
      limit
    });
  } catch (error: any) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
