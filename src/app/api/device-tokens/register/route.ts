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
    const { deviceToken, platform = 'web', permissionStatus = 'GRANTED' } = body;

    if (!deviceToken) {
      return NextResponse.json({ error: 'Device token is required' }, { status: 400 });
    }

    // Upsert device token
    const { error: upsertErr } = await supabaseAdmin
      .from('user_devices')
      .upsert({
        user_id: userId,
        device_token: deviceToken,
        platform,
        permission_status: permissionStatus,
        is_active: true,
        last_seen: new Date().toISOString()
      }, {
        onConflict: 'user_id,device_token'
      });

    if (upsertErr) {
      throw upsertErr;
    }

    // Log Audit Action
    await logAuditAction({
      admin_id: userId,
      action: AuditAction.DEVICE_REGISTERED,
      target_type: 'user',
      target_id: userId,
      metadata: { platform, permissionStatus }
    });

    return NextResponse.json({ success: true, message: 'Device registered successfully' });

  } catch (error: any) {
    console.error('Error registering device:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
