import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cacheHeaders });
    }
    const customerId = session.user_id;

    // 1. Fetch or initialize customer wallet
    let { data: wallet, error: walletErr } = await supabaseAdmin
      .from('customer_wallets')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (walletErr) throw walletErr;

    if (!wallet) {
      // Auto-create wallet
      const { data: newWallet, error: createErr } = await supabaseAdmin
        .from('customer_wallets')
        .insert({
          customer_id: customerId,
          balance: 0.00
        })
        .select('*')
        .single();

      if (createErr) {
        console.error('[Customer Wallet] Failed to auto-create wallet:', createErr);
      } else {
        wallet = newWallet;
      }
    }

    // 2. Fetch last 20 transactions
    const { data: transactions, error: txErr } = await supabaseAdmin
      .from('customer_wallet_transactions')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (txErr) throw txErr;

    return NextResponse.json({
      balance: wallet ? Number(wallet.balance) : 0,
      transactions: transactions || []
    }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching customer wallet:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}

// Simulated top-up route for customer testing
export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const customerId = session.user_id;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const amount = Number(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // 1. Get or create wallet
    let { data: wallet } = await supabaseAdmin
      .from('customer_wallets')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (!wallet) {
      const { data: newWallet } = await supabaseAdmin
        .from('customer_wallets')
        .insert({ customer_id: customerId, balance: 0.00 })
        .select('*')
        .single();
      wallet = newWallet;
    }

    if (!wallet) {
      return NextResponse.json({ error: 'Failed to create wallet' }, { status: 500 });
    }

    const newBalance = Number(wallet.balance) + amount;

    // Update balance
    const { error: updateErr } = await supabaseAdmin
      .from('customer_wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('customer_id', customerId);

    if (updateErr) throw updateErr;

    // Log transaction
    await supabaseAdmin.from('customer_wallet_transactions').insert({
      customer_id: customerId,
      amount: amount,
      type: 'TOP_UP',
      description: `Topped up ₹${amount} via online payment`
    });

    return NextResponse.json({ success: true, balance: newBalance });
  } catch (error: any) {
    console.error('Error topping up customer wallet:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
