import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'admin');
    const { id: customerId } = await params;
    const { data: { amount, reason, bookingId }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required.' }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: 'Reason for refund is required.' }, { status: 400 });
    }

    // Use RPC function from migration 041 if it exists, or do it manually
    // We'll do it manually with a transaction-like sequence (though true transactions require an RPC)
    
    // 1. Get current balance
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('customer_wallets')
      .select('balance')
      .eq('customer_id', customerId)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json({ error: 'Customer wallet not found.' }, { status: 404 });
    }

    // 2. Insert transaction
    const { error: txError } = await supabaseAdmin
      .from('customer_wallet_transactions')
      .insert({
        customer_id: customerId,
        amount: amount,
        type: 'REFUND',
        reference_type: 'ADMIN_ADJUSTMENT',
        reference_id: bookingId || null,
        description: reason,
        status: 'COMPLETED'
      });

    if (txError) throw txError;

    // 3. Update balance
    const newBalance = Number(wallet.balance) + Number(amount);
    const { error: updateError } = await supabaseAdmin
      .from('customer_wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('customer_id', customerId);

    if (updateError) throw updateError;

    // Optional: Log audit action
    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: session.user_id,
      action: 'WALLET_REFUND',
      target_type: 'customer',
      target_id: customerId,
      metadata: { amount, reason, bookingId }
    });

    return NextResponse.json({ success: true, message: 'Refund issued successfully.', newBalance });
  } catch (error: any) {
    console.error('Error issuing refund:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
