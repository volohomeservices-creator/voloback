import { setPinSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { requireSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { logAuthEvent } from '@/lib/session';

export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    // 1. Authenticate user
    let session;
    try {
      session = await requireSession(request);
    } catch (err: any) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cacheHeaders });
    }

    const validation = await validateBody(request, setPinSchema);
    if (!validation.success) return validation.errorResponse;
    const { pin } = validation.data;

    if (!pin) {
      return NextResponse.json({ error: 'PIN is required' }, { status: 400, headers: cacheHeaders });
    }

    // Validate PIN format (4 to 6 digits)
    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be between 4 and 6 digits long' }, { status: 400, headers: cacheHeaders });
    }

    // Reject weak/common PINs
    const weakPins = [
      '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
      '1234', '4321', '0123', '2345', '3456', '4567', '5678', '6789',
      '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
      '123456', '654321'
    ];
    if (weakPins.includes(pin)) {
      return NextResponse.json({ error: 'PIN is too common. Please choose a stronger PIN.' }, { status: 400, headers: cacheHeaders });
    }

    // Hash the PIN using bcryptjs
    const pinHash = await bcryptjs.hash(pin, 12);

    // Save hashed PIN to database
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        pin_hash: pinHash,
        pin_set_at: new Date().toISOString(),
        pin_attempts: 0,
        pin_locked_until: null
      })
      .eq('id', session.user_id);

    if (updateError) {
      console.error('[Set PIN] Error updating user PIN hash:', updateError);
      return NextResponse.json({ error: 'Failed to set PIN' }, { status: 500, headers: cacheHeaders });
    }

    // Log security audit event
    await logAuthEvent(session.user_id, session.firebase_uid, 'pin_set', null, request);

    return NextResponse.json({ success: true }, { headers: cacheHeaders });

  } catch (err) {
    console.error('[Set PIN] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
