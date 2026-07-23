import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { calculateWorkerSettlement } from '@/lib/settlement-engine';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'worker');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cacheHeaders });

    const earnings = await calculateWorkerSettlement(session.user_id);

    const { data: history } = await supabaseAdmin
      .from('settlement_ledger')
      .select('*, settlement_batches(batch_reference, status)')
      .eq('worker_id', session.user_id)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      earnings: earnings || {
        gross_earnings: 0,
        commission: 0,
        net_earnings: 0,
        pending_amount: 0,
        processing_amount: 0,
        ready_for_payout_amount: 0,
        paid_amount: 0
      },
      history: history || []
    }, { headers: cacheHeaders });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: cacheHeaders });
  }
}
