import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getPaginationParams } from '@/lib/pagination';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const { searchParams } = new URL(request.url);
    const { page, limit, offset } = getPaginationParams(searchParams);
    
    const status = searchParams.get('status') || ''; // COMPLETED or CANCELLED
    const dateFrom = searchParams.get('date_from') || '';
    const dateTo = searchParams.get('date_to') || '';
    const search = searchParams.get('search') || ''; // service name filter

    let query = supabaseAdmin
      .from('bookings')
      .select('*, service_items!inner(name), customer:users!bookings_customer_id_fkey(full_name, phone)', { count: 'exact' })
      .eq('worker_id', workerId);

    // Filter by completed or cancelled status
    if (status) {
      query = query.eq('status', status);
    } else {
      query = query.in('status', ['COMPLETED', 'CANCELLED']);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Search query on service name
    if (search) {
      query = query.ilike('service_items.name', `%${search}%`);
    }

    const { data: bookings, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const history = (bookings || []).map((b: any) => ({
      id: b.id,
      service_name: b.service_items?.name || 'Home Service',
      customer_area: b.address_line ? b.address_line.split(',')[0] : 'Nearby',
      date: b.created_at,
      status: b.status,
      earnings: Number((b.total_amount * 0.85).toFixed(2))
    }));

    return NextResponse.json({
      history,
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error: any) {
    console.error('Error fetching job history:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
