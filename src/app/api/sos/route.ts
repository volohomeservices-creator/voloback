import { sosTriggerSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

import { requireSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const user_id = session.user_id;

    const validation = await validateBody(request, sosTriggerSchema);
    if (!validation.success) return validation.errorResponse;
    const { booking_id, lat, lng } = validation.data;

    const { data, error } = await supabaseAdmin
      .from('sos_alerts')
      .insert({
        user_id,
        booking_id: booking_id || null,
        lat,
        lng,
        status: 'ACTIVE'
      })
      .select()
      .single();

    if (error) throw error;

    // We can also trigger SMS/Calls here via Twilio, etc.

    return NextResponse.json({ success: true, message: 'SOS triggered successfully.', alert: data });
  } catch (error: any) {
    console.error('Error triggering SOS:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
