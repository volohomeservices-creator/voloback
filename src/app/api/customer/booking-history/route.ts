import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const customerId = session.user_id;

    const { searchParams } = new URL(request.url);
    const { page, limit, offset } = getPaginationParams(searchParams);

    // Fetch historical bookings (completed or cancelled)
    const { data: bookings, count, error } = await supabaseAdmin
      .from('bookings')
      .select('*, service_items(name, description, base_price, estimated_mins), workers(users(full_name)), reviews(rating, comment:review_text)', { count: 'exact' })
      .eq('customer_id', customerId)
      .in('status', ['COMPLETED', 'CANCELLED'])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({ 
      bookings: bookings || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error: any) {
    console.error('Error fetching customer booking history:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
