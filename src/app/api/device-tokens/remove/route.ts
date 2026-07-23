import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const userId = session.user_id;

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { deviceToken } = body;

    if (!deviceToken) {
      return NextResponse.json({ error: 'Device token is required' }, { status: 400 });
    }

    // Deactivate device token
    const { error: updateErr } = await supabaseAdmin
      .from('user_devices')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('device_token', deviceToken);

    if (updateErr) {
      throw updateErr;
    }

    // Log Audit Action
    await logAuditAction({
      admin_id: userId,
      action: AuditAction.DEVICE_REMOVED,
      target_type: 'user',
      target_id: userId,
      metadata: { action: 'logout_or_explicit_removal' }
    });

    return NextResponse.json({ success: true, message: 'Device removed successfully' });

  } catch (error: any) {
    console.error('Error removing device:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
