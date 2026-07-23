import 'server-only';
import { supabaseAdmin } from '../supabase-server';

export async function getAdminPayoutReport(startDate?: Date, endDate?: Date) {
  let query = supabaseAdmin.from('payouts').select('amount, status, created_at');

  if (startDate) query = query.gte('created_at', startDate.toISOString());
  if (endDate) query = query.lte('created_at', endDate.toISOString());

  const { data, error } = await query;
  if (error || !data) return null;

  let totalVolume = 0;
  let pendingVolume = 0;
  let readyVolume = 0;
  let processingVolume = 0;
  let paidVolume = 0;
  let failedVolume = 0;

  data.forEach(p => {
    const amt = Number(p.amount || 0);
    totalVolume += amt;
    if (p.status === 'PENDING') pendingVolume += amt;
    if (p.status === 'READY_FOR_PAYOUT') readyVolume += amt;
    if (p.status === 'PROCESSING' || p.status === 'QUEUED') processingVolume += amt;
    if (p.status === 'PAID') paidVolume += amt;
    if (p.status === 'FAILED') failedVolume += amt;
  });

  return { totalVolume, pendingVolume, readyVolume, processingVolume, paidVolume, failedVolume };
}

export async function getWorkerPayoutReport(workerId: string) {
  const { data, error } = await supabaseAdmin
    .from('payouts')
    .select('amount, status')
    .eq('worker_id', workerId);

  if (error || !data) return null;

  let lifetimePaid = 0;
  let upcomingAmount = 0;
  let failedAmount = 0;

  data.forEach(p => {
    const amt = Number(p.amount || 0);
    if (p.status === 'PAID') lifetimePaid += amt;
    if (p.status === 'FAILED') failedAmount += amt;
    if (['PENDING', 'READY_FOR_PAYOUT', 'QUEUED', 'PROCESSING'].includes(p.status)) upcomingAmount += amt;
  });

  return { lifetimePaid, upcomingAmount, failedAmount };
}
