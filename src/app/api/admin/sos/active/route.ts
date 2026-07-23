import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');

    // Fetch all active SOS alerts
    const { data, error } = await supabaseAdmin
      .from('sos_alerts')
      .select(`
        id,
        user_id,
        booking_id,
        lat,
        lng,
        status,
        created_at,
        user:user_id (full_name, phone, role)
      `)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ active_alerts: data || [] });
  } catch (error: any) {
    console.error('Error fetching active SOS alerts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: { id }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!id) {
      return NextResponse.json({ error: 'SOS ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('sos_alerts')
      .update({
        status: 'RESOLVED',
        resolved_by: session.user_id,
        resolved_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'SOS resolved successfully.' });
  } catch (error: any) {
    console.error('Error resolving SOS:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
