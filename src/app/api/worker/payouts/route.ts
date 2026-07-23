import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getWorkerPayoutReport } from '@/lib/payouts/payout-reporting';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const report = await getWorkerPayoutReport(session.user_id);

    const { data: payouts, error } = await supabaseAdmin
      .from('payouts')
      .select('id, amount, status, created_at, settlement_batches(batch_reference)')
      .eq('worker_id', session.user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({
      report: report || { lifetimePaid: 0, upcomingAmount: 0, failedAmount: 0 },
      payouts: payouts || []
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
