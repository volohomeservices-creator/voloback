import 'server-only';
import { supabaseAdmin } from '../supabase-server';
import { logAuditAction } from '../audit';
import { AuditAction } from '@/types';
import { PayoutStatus } from './payout-types';
import { DefaultPayoutProvider } from './payout-provider';
import { ProviderNotConfiguredError } from './payout-errors';
import { dispatchNotification } from '../notification-dispatcher';

export class PayoutService {
  private static provider = new DefaultPayoutProvider();

  /**
   * Called when an admin marks a Settlement Batch as READY_FOR_PAYOUT
   */
  static async queuePayoutsForBatch(batchId: string, adminId: string) {
    // 1. Fetch settlements in the batch
    const { data: settlements, error: fetchErr } = await supabaseAdmin
      .from('settlement_ledger')
      .select('id, worker_id, net_amount')
      .eq('settlement_batch_id', batchId);

    if (fetchErr) throw fetchErr;
    if (!settlements || settlements.length === 0) return { success: true, count: 0 };

    let createdCount = 0;

    for (const settlement of settlements) {
      if (Number(settlement.net_amount) <= 0) continue; // No payout needed

      const { data: payout, error: insertErr } = await supabaseAdmin
        .from('payouts')
        .insert({
          worker_id: settlement.worker_id,
          settlement_batch_id: batchId,
          settlement_ledger_id: settlement.id,
          amount: settlement.net_amount,
          status: PayoutStatus.READY_FOR_PAYOUT
        })
        .select('id')
        .single();

      if (!insertErr && payout) {
        createdCount++;
        await logAuditAction({
          admin_id: adminId,
          action: 'PAYOUT_CREATED' as AuditAction,
          target_type: 'payouts',
          target_id: payout.id,
          metadata: { amount: settlement.net_amount }
        });
      }
    }

    return { success: true, count: createdCount };
  }

  /**
   * Future method to execute queued payouts
   */
  static async executePendingPayouts() {
    const { data: config } = await supabaseAdmin
      .from('payout_provider_configs')
      .select('enabled')
      .eq('provider_name', 'RAZORPAYX')
      .single();

    if (!config || !config.enabled) {
      // Silently log and abort
      console.warn('Payout provider is disabled. Execution aborted.');
      return;
    }

    // Logic to scoop READY_FOR_PAYOUT records, update to QUEUED, and pass to provider
    // ...
  }
}
