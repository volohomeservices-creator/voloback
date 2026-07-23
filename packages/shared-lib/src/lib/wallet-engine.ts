import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { logAuditAction } from './audit';
import { AuditAction, WalletTxnType } from '@/types';

export async function createWallet(workerId: string): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('worker_wallets')
    .select('id')
    .eq('worker_id', workerId)
    .single();

  if (existing) {
    return true; // Already exists
  }

  const { error } = await supabaseAdmin
    .from('worker_wallets')
    .insert({
      worker_id: workerId,
      balance: 0,
      minimum_balance: -500,
      is_active: true
    });

  if (error) {
    console.error('[Wallet Engine] Failed to create wallet:', error);
    return false;
  }

  await logAuditAction({
    admin_id: workerId,
    action: AuditAction.WALLET_CREATED,
    target_type: 'worker',
    target_id: workerId,
    metadata: { initial_balance: 0, minimum_balance: -500 }
  });

  return true;
}

export async function getBalance(workerId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('worker_wallets')
    .select('balance')
    .eq('worker_id', workerId)
    .single();

  if (error || !data) {
    return 0;
  }

  return Number(data.balance);
}

export async function validateWallet(workerId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('worker_wallets')
    .select('balance, minimum_balance')
    .eq('worker_id', workerId)
    .single();

  if (error || !data) {
    return false;
  }

  return Number(data.balance) >= Number(data.minimum_balance);
}

export async function deductCommission(
  workerId: string,
  bookingId: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  // Use a Postgres function to safely deduct and create ledger entry in a transaction
  const { data, error } = await supabaseAdmin.rpc('deduct_wallet_commission', {
    p_worker_id: workerId,
    p_booking_id: bookingId,
    p_amount: amount
  });

  if (error) {
    console.error('[Wallet Engine] Error deducting commission:', error);
    return { success: false, error: error.message };
  }

  await logAuditAction({
    admin_id: workerId,
    action: AuditAction.COMMISSION_DEDUCTED,
    target_type: 'worker',
    target_id: workerId,
    metadata: { booking_id: bookingId, amount }
  });

  return { success: true };
}
