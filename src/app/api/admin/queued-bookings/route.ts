import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { getPaginationParams } from '@/lib/pagination';

export async function GET(request: Request) {
  try {
    // 1. Secure route with admin permission check
    const session = await requireRole(request, 'admin');
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { 
          status: 401,
          headers: {
            'Cache-Control': 'no-store, max-age=0, must-revalidate'
          }
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit, offset } = getPaginationParams(searchParams);

    // 2. Fetch bookings requiring manual assignment
    const { data: bookings, count, error } = await supabaseAdmin
      .from('bookings')
      .select(`
        id,
        status,
        address_line,
        created_at,
        customer:users!bookings_customer_id_fkey(full_name, phone),
        service_items(
          name,
          service_categories(name)
        ),
        assignment_queue(
          current_group,
          group_workers,
          attempts,
          started_at
        )
      `, { count: 'exact' })
      .eq('status', 'MANUAL_ASSIGNMENT_REQUIRED')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching unassigned bookings:', error);
      throw error;
    }

    const now = Date.now();
    const mappedBookings = (bookings || []).map((b: any) => {
      const createdAtTime = new Date(b.created_at).getTime();
      const waitingMins = Math.round((now - createdAtTime) / 60000);

      return {
        id: b.id,
        created_at: b.created_at,
        address_line: b.address_line,
        customer_name: b.customer?.full_name || 'N/A',
        customer_phone: b.customer?.phone || 'N/A',
        service_name: b.service_items?.name || 'N/A',
        category_name: b.service_items?.service_categories?.name || 'N/A',
        attempts: b.assignment_queue?.attempts || 0,
        current_group: b.assignment_queue?.current_group || 0,
        started_at: b.assignment_queue?.started_at || null,
        waiting_mins: waitingMins
      };
    });

    return NextResponse.json(
      {
        bookings: mappedBookings,
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate'
        }
      }
    );
  } catch (error: any) {
    console.error('Error in queued bookings API:', error);
    const status = error.status || 500;
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { 
        status,
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate'
        }
      }
    );
  }
}
