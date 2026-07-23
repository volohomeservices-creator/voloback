import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { dispatchNotification } from '@/lib/notification-dispatcher';

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: { segment, title, body, data }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!title || !body) {
      return NextResponse.json({ error: 'Title and body are required.' }, { status: 400 });
    }

    let userIdsToNotify: string[] = [];

    // Simple segmentation logic
    if (segment === 'ALL_CUSTOMERS') {
      const { data: users } = await supabaseAdmin.from('users').select('id').eq('role', 'customer').eq('is_active', true);
      userIdsToNotify = (users as any[])?.map((u: any) => u.id) || [];
    } else if (segment === 'INACTIVE_30_DAYS') {
      // Find customers with no bookings in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: activeUsers } = await supabaseAdmin
        .from('bookings')
        .select('customer_id')
        .gte('created_at', thirtyDaysAgo.toISOString());
        
      const activeUserIds = (activeUsers as any[])?.map((b: any) => b.customer_id) || [];
      
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'customer')
        .eq('is_active', true);
        
      userIdsToNotify = ((users as any[])?.map((u: any) => u.id) || []).filter(id => !activeUserIds.includes(id));
    } else if (segment === 'ALL_WORKERS') {
      const { data: workers } = await supabaseAdmin.from('workers').select('id');
      userIdsToNotify = (workers as any[])?.map((w: any) => w.id) || [];
    } else {
      return NextResponse.json({ error: 'Invalid segment selected.' }, { status: 400 });
    }

    if (userIdsToNotify.length === 0) {
      return NextResponse.json({ message: 'No users found in this segment to notify.', count: 0 });
    }

    // Send notifications in batches to avoid timeout
    const batchSize = 100;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < userIdsToNotify.length; i += batchSize) {
      const batch = userIdsToNotify.slice(i, i + batchSize);
      
      const notificationPromises = batch.map(userId => 
        dispatchNotification({
          userId,
          type: 'BROADCAST',
          title,
          body,
          data
        }).then(() => { successCount++; })
          .catch(() => { failureCount++; })
      );
      
      await Promise.allSettled(notificationPromises);
    }

    // Log the broadcast
    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: session.user_id,
      action: 'BROADCAST_NOTIFICATION',
      target_type: 'platform',
      target_id: 'ALL',
      metadata: { segment, title, body, successCount, failureCount }
    });

    return NextResponse.json({ 
      success: true, 
      message: `Notification dispatched to segment ${segment}.`,
      stats: { successCount, failureCount }
    });
  } catch (error: any) {
    console.error('Error dispatching segment notification:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
