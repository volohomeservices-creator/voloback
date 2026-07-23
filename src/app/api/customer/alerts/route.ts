import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;

    const { data: notifications, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ notifications: notifications || [] }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching customer alerts:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const customerId = session.user_id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', customerId);

    if (error) throw error;

    return NextResponse.json({ success: true }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error clearing customer alerts:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}
