import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

// GET: return all referral settings
export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');

    const { data, error } = await supabaseAdmin
      .from('referral_settings')
      .select('*')
      .order('role');

    if (error) throw error;
    return NextResponse.json({ settings: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// PUT: update referral settings for a role
export async function PUT(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { role, referrer_reward, referee_reward, min_bookings_to_qualify, active } = body;

    if (!role || !['customer', 'worker'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('referral_settings')
      .update({
        referrer_reward: Number(referrer_reward),
        referee_reward: Number(referee_reward),
        min_bookings_to_qualify: Number(min_bookings_to_qualify),
        active: Boolean(active),
        updated_at: new Date().toISOString(),
        updated_by: session.user_id,
      })
      .eq('role', role)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ setting: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
