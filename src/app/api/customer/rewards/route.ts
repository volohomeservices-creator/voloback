import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');

    // Get current coins
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('volo_coins')
      .eq('id', session.user_id)
      .single();

    if (userErr) throw userErr;

    // Get coin history
    const { data: history, error: historyErr } = await supabaseAdmin
      .from('volo_coin_transactions')
      .select('*')
      .eq('user_id', session.user_id)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      coins: user?.volo_coins || 0,
      history: history || []
    });
  } catch (error: any) {
    console.error('Error fetching rewards:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const { data: { amountToConvert }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!amountToConvert || amountToConvert <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // In a real app, use a postgres function/transaction for safety!
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('volo_coins')
      .eq('id', session.user_id)
      .single();

    if (!user || user.volo_coins < amountToConvert) {
      return NextResponse.json({ error: 'Insufficient Volo Coins' }, { status: 400 });
    }

    // Conversion rate: 10 coins = ₹1
    const walletCredit = amountToConvert / 10;

    // 1. Deduct Coins
    await supabaseAdmin
      .from('users')
      .update({ volo_coins: user.volo_coins - amountToConvert })
      .eq('id', session.user_id);

    // 2. Log coin transaction
    await supabaseAdmin
      .from('volo_coin_transactions')
      .insert({
        user_id: session.user_id,
        amount: -amountToConvert,
        description: `Converted to ₹${walletCredit} wallet balance`
      });

    // 3. Add to Wallet
    const { data: wallet } = await supabaseAdmin
      .from('customer_wallets')
      .select('*')
      .eq('customer_id', session.user_id)
      .single();
      
    if (wallet) {
      await supabaseAdmin
        .from('customer_wallets')
        .update({ balance: Number(wallet.balance) + walletCredit })
        .eq('id', wallet.id);
        
      // Record wallet transaction
      await supabaseAdmin
        .from('customer_wallet_transactions')
        .insert({
          wallet_id: wallet.id,
          amount: walletCredit,
          type: 'CREDIT',
          description: `Volo Coins Redemption`,
          status: 'COMPLETED'
        });
    }

    return NextResponse.json({ success: true, converted: walletCredit });
  } catch (error: any) {
    console.error('Error converting rewards:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
