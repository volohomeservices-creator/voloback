import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function PATCH(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    // 1. Fetch worker KYC status
    const { data: worker, error: workerErr } = await supabaseAdmin
      .from('workers')
      .select('kyc_status, status')
      .eq('id', workerId)
      .single();

    if (workerErr || !worker) {
      return NextResponse.json({ error: 'Worker profile not found.' }, { status: 404 });
    }

    // 2. Enforce restriction: must be KYC APPROVED
    if (worker.kyc_status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'KYC approval is required before accepting jobs.' },
        { status: 403 }
      );
    }

    const { data: { status }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    if (status !== 'ONLINE' && status !== 'OFFLINE') {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    // 3. Update status in workers table
    const { error: updateErr } = await supabaseAdmin
      .from('workers')
      .update({
        status,
        location_updated_at: new Date().toISOString()
      })
      .eq('id', workerId);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      status
    });
  } catch (error: any) {
    console.error('Error toggling worker status:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
