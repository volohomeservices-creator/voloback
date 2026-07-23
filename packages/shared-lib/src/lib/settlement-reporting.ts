import 'server-only';
import { supabaseAdmin } from './supabase-server';

export async function getWeeklySettlementReport(weekStartDate: Date, weekEndDate: Date) {
  const { data, error } = await supabaseAdmin
    .from('settlement_batches')
    .select('batch_type, gross_amount, commission_amount, net_amount, total_transactions')
    .gte('created_at', weekStartDate.toISOString())
    .lte('created_at', weekEndDate.toISOString());

  if (error || !data) return null;

  let wednesdayBatchTotal = 0;
  let sundayBatchTotal = 0;
  let totalCommission = 0;
  let netPayout = 0;
  let combinedWeeklyTotalGross = 0;

  data.forEach(batch => {
    const gross = Number(batch.gross_amount || 0);
    const comm = Number(batch.commission_amount || 0);
    const net = Number(batch.net_amount || 0);

    combinedWeeklyTotalGross += gross;
    totalCommission += comm;
    netPayout += net;

    if (batch.batch_type === 'WEDNESDAY') wednesdayBatchTotal += net;
    if (batch.batch_type === 'SUNDAY') sundayBatchTotal += net;
  });

  return {
    wednesdayBatchTotal,
    sundayBatchTotal,
    combinedWeeklyTotalGross,
    totalCommission,
    netPayout
  };
}

export async function getMonthlySettlementReport(monthStartDate: Date, monthEndDate: Date) {
  const { data, error } = await supabaseAdmin
    .from('settlement_batches')
    .select('status, gross_amount, commission_amount, net_amount')
    .gte('created_at', monthStartDate.toISOString())
    .lte('created_at', monthEndDate.toISOString());

  if (error || !data) return null;

  let platformRevenue = 0;
  let workerEarnings = 0;
  let totalBatches = data.length;
  let successBatches = 0;

  data.forEach(batch => {
    platformRevenue += Number(batch.commission_amount || 0);
    workerEarnings += Number(batch.net_amount || 0);

    if (batch.status === 'PAID') successBatches++;
  });

  const settlementSuccessRate = totalBatches > 0 ? (successBatches / totalBatches) * 100 : 0;

  return {
    platformRevenue,
    workerEarnings,
    settlementSuccessRate
  };
}
