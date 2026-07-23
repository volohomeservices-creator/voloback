import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { AuditAction } from '@/types';
import { logAuditAction } from './audit';
import { dispatchNotification } from './notification-dispatcher';
import { PayoutService } from './payouts/payout-service';
import { encryptData, decryptData } from './crypto';

export function encryptBankAccount(text: string) {
  return encryptData(text);
}

export function decryptBankAccount(text: string) {
  return decryptData(text);
}

/**
 * calculateWorkerSettlement
 * Returns: Gross Earnings, Commission, Net Earnings, Pending Amount, Processing Amount, Ready For Payout Amount
 */
export async function calculateWorkerSettlement(workerId: string) {
  const { data: ledger, error } = await supabaseAdmin
    .from('settlement_ledger')
    .select('gross_amount, commission_amount, net_amount, status')
    .eq('worker_id', workerId);

  if (error || !ledger) return null;

  let gross_earnings = 0;
  let commission = 0;
  let net_earnings = 0;
  let pending_amount = 0;
  let processing_amount = 0;
  let ready_for_payout_amount = 0;
  let paid_amount = 0;

  ledger.forEach(entry => {
    gross_earnings += Number(entry.gross_amount || 0);
    commission += Number(entry.commission_amount || 0);
    net_earnings += Number(entry.net_amount || 0);

    if (entry.status === 'PENDING') pending_amount += Number(entry.net_amount || 0);
    else if (entry.status === 'PROCESSING') processing_amount += Number(entry.net_amount || 0);
    else if (entry.status === 'READY_FOR_PAYOUT') ready_for_payout_amount += Number(entry.net_amount || 0);
    else if (entry.status === 'PAID') paid_amount += Number(entry.net_amount || 0);
  });

  return {
    gross_earnings,
    commission,
    net_earnings,
    pending_amount,
    processing_amount,
    ready_for_payout_amount,
    paid_amount
  };
}

/**
 * generateSettlementBatch
 * Triggered Wednesday 10 AM or Sunday 6 PM
 * Finds PENDING, creates Batch, links them, sets PROCESSING
 */
export async function generateSettlementBatch(batchType: 'WEDNESDAY' | 'SUNDAY') {
  try {
    // 1. Fetch all PENDING settlements
    const { data: pendingSettlements, error: fetchErr } = await supabaseAdmin
      .from('settlement_ledger')
      .select('id, worker_id, gross_amount, commission_amount, net_amount')
      .eq('status', 'PENDING');

    if (fetchErr) throw fetchErr;
    if (!pendingSettlements || pendingSettlements.length === 0) {
      return { success: true, message: 'No pending settlements found.' };
    }

    // 2. Aggregate data
    let totalGross = 0;
    let totalCommission = 0;
    let totalNet = 0;
    const workerIds = new Set<string>();

    pendingSettlements.forEach(s => {
      totalGross += Number(s.gross_amount || 0);
      totalCommission += Number(s.commission_amount || 0);
      totalNet += Number(s.net_amount || 0);
      workerIds.add(s.worker_id);
    });

    const batchReference = `SET-${new Date().getFullYear()}-${batchType.substring(0, 3)}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

    // 3. Create Batch
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from('settlement_batches')
      .insert({
        batch_reference: batchReference,
        batch_type: batchType,
        total_workers: workerIds.size,
        total_transactions: pendingSettlements.length,
        gross_amount: totalGross,
        commission_amount: totalCommission,
        net_amount: totalNet,
        status: 'PROCESSING'
      })
      .select('id')
      .single();

    if (batchErr || !batch) throw batchErr;

    const settlementIds = pendingSettlements.map(s => s.id);

    // 4. Update Ledger Entries
    const { error: updateErr } = await supabaseAdmin
      .from('settlement_ledger')
      .update({
        status: 'PROCESSING',
        settlement_batch_id: batch.id,
        updated_at: new Date().toISOString()
      })
      .in('id', settlementIds);

    if (updateErr) throw updateErr;

    // 5. Notify Admins
    const { data: admins } = await supabaseAdmin.from('users').select('id').eq('role', 'admin');
    if (admins) {
      for (const admin of admins) {
        await dispatchNotification({
          userId: admin.id,
          type: 'MANUAL_ASSIGNMENT_CREATED' as any, // Reusing enum or we can use custom type
          title: `${batchType} Batch Generated`,
          body: `Batch ${batchReference} created with ${pendingSettlements.length} transactions.`,
          data: { batch_id: batch.id }
        });
      }
    }

    // 6. Audit Log
    await logAuditAction({
      admin_id: 'system',
      action: AuditAction.SETTLEMENT_BATCH_CREATED,
      target_type: 'settlement_batches',
      target_id: batch.id,
      metadata: { batch_reference: batchReference, net_amount: totalNet }
    });

    return { success: true, batch_id: batch.id, batch_reference: batchReference };
  } catch (error: any) {
    console.error('Failed to generate settlement batch:', error);
    return { success: false, error: error.message };
  }
}

/**
 * markReadyForPayout
 * Admin action to approve a PROCESSING batch.
 */
export async function markReadyForPayout(batchId: string, adminId: string) {
  try {
    const { data: batch, error: fetchErr } = await supabaseAdmin
      .from('settlement_batches')
      .select('status')
      .eq('id', batchId)
      .single();

    if (fetchErr || !batch) throw new Error('Batch not found');
    if (batch.status !== 'PROCESSING') throw new Error(`Cannot mark ${batch.status} as READY_FOR_PAYOUT`);

    // Update Batch
    const { error: batchUpdateErr } = await supabaseAdmin
      .from('settlement_batches')
      .update({ status: 'READY_FOR_PAYOUT', updated_at: new Date().toISOString() })
      .eq('id', batchId);

    if (batchUpdateErr) throw batchUpdateErr;

    // Update Ledger
    const { error: ledgerUpdateErr } = await supabaseAdmin
      .from('settlement_ledger')
      .update({ status: 'READY_FOR_PAYOUT', updated_at: new Date().toISOString() })
      .eq('settlement_batch_id', batchId);

    if (ledgerUpdateErr) throw ledgerUpdateErr;

    await logAuditAction({
      admin_id: adminId,
      action: AuditAction.SETTLEMENT_READY_FOR_PAYOUT,
      target_type: 'settlement_batches',
      target_id: batchId,
      metadata: { previous_status: batch.status }
    });

    // Automatically queue payouts for this batch (Phase 14 Payout Architecture)
    await PayoutService.queuePayoutsForBatch(batchId, adminId);

    return { success: true };
  } catch (error: any) {
    console.error('Error marking batch ready for payout:', error);
    return { success: false, error: error.message };
  }
}

/**
 * markPaid
 * Future Phase 14 Hook.
 */
export async function markPaid(batchId: string, transactionReference: string, adminId: string) {
  try {
    const { error: batchUpdateErr } = await supabaseAdmin
      .from('settlement_batches')
      .update({ status: 'PAID', updated_at: new Date().toISOString() })
      .eq('id', batchId);

    if (batchUpdateErr) throw batchUpdateErr;

    const { error: ledgerUpdateErr } = await supabaseAdmin
      .from('settlement_ledger')
      .update({ status: 'PAID', updated_at: new Date().toISOString() })
      .eq('settlement_batch_id', batchId);

    if (ledgerUpdateErr) throw ledgerUpdateErr;

    await logAuditAction({
      admin_id: adminId,
      action: AuditAction.SETTLEMENT_PAID,
      target_type: 'settlement_batches',
      target_id: batchId,
      metadata: { transactionReference }
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error marking batch as paid:', error);
    return { success: false, error: error.message };
  }
}
