import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { filterRealNotifications } from '@/lib/notification-dispatcher';

const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const { data: notificationsRaw, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', workerId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const notifications = await filterRealNotifications(notificationsRaw || [], workerId);

    return NextResponse.json({ notifications }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching worker alerts:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', workerId);

    if (error) throw error;

    return NextResponse.json({ success: true }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error clearing worker alerts:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}
