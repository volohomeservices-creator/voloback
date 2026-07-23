import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, 'admin');
    const { id: workerId } = await params;

    const { data, error } = await supabaseAdmin
      .from('worker_strikes')
      .select('id, reason, created_at, admin:admin_id(full_name)')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ strikes: data });
  } catch (error: any) {
    console.error('Error fetching strikes:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'admin');
    const { id: workerId } = await params;
    const { data: { reason }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!reason) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('worker_strikes')
      .insert({
        worker_id: workerId,
        admin_id: session.user_id,
        reason
      });

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Strike issued successfully.' });
  } catch (error: any) {
    console.error('Error issuing strike:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
