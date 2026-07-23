import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { dispatchNotification, dispatchBulkNotifications } from '@/lib/notification-dispatcher';

export async function POST(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { target, target_user_id, title, body: msgBody } = body;

    if (!title || !msgBody) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
    }

    let sentCount = 0;

    if (target === 'specific' && target_user_id) {
      // Send to one specific user
      await dispatchNotification({
        userId: target_user_id,
        type: 'ADMIN_BROADCAST',
        title,
        body: msgBody,
      });
      sentCount = 1;

    } else if (target === 'all_customers') {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'customer')
        .eq('is_active', true);

      const userIds = (users || []).map((u: any) => u.id);
      if (userIds.length > 0) {
        await dispatchBulkNotifications({ userIds, type: 'ADMIN_BROADCAST', title, body: msgBody });
        sentCount = userIds.length;
      }

    } else if (target === 'all_workers') {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'worker')
        .eq('is_active', true);

      const userIds = (users || []).map((u: any) => u.id);
      if (userIds.length > 0) {
        await dispatchBulkNotifications({ userIds, type: 'ADMIN_BROADCAST', title, body: msgBody });
        sentCount = userIds.length;
      }

    } else if (target === 'everyone') {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_active', true);

      const userIds = (users || []).map((u: any) => u.id);
      if (userIds.length > 0) {
        await dispatchBulkNotifications({ userIds, type: 'ADMIN_BROADCAST', title, body: msgBody });
        sentCount = userIds.length;
      }

    } else {
      return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
    }

    // Log the broadcast in notifications_log (audit)
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: null,
        type: 'ADMIN_BROADCAST_LOG',
        title: `[ADMIN BROADCAST] ${title}`,
        body: `Target: ${target}, Sent: ${sentCount}`,
      });
    } catch (_) { /* non-fatal */ }

    return NextResponse.json({ success: true, sent_count: sentCount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// GET: search users by phone to find target_user_id
export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');

    if (!phone) return NextResponse.json({ users: [] });

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, role')
      .ilike('phone', `%${phone}%`)
      .limit(5);

    if (error) throw error;
    return NextResponse.json({ users: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
