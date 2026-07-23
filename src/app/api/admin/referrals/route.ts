import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { dispatchNotification } from '@/lib/notification-dispatcher';

// GET: List all referrals with referrer + referred user info
export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const role = searchParams.get('role');

    let query = supabaseAdmin
      .from('referrals')
      .select(`
        id,
        status,
        reward_amount,
        role,
        created_at,
        rewarded_at,
        referral_code,
        referrer:users!referrals_referrer_id_fkey(id, full_name, phone),
        referred:users!referrals_referred_user_id_fkey(id, full_name, phone)
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (role) query = query.eq('role', role);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ referrals: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// PATCH: Mark referral as REWARDED and notify referrer
export async function PATCH(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: { referral_id }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!referral_id) {
      return NextResponse.json({ error: 'referral_id is required' }, { status: 400 });
    }

    // Get the referral row
    const { data: referral, error: fetchErr } = await supabaseAdmin
      .from('referrals')
      .select('id, referrer_id, reward_amount, status, role')
      .eq('id', referral_id)
      .single();

    if (fetchErr || !referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    if (referral.status === 'REWARDED') {
      return NextResponse.json({ error: 'Already rewarded' }, { status: 400 });
    }

    // Update status
    const { error: updateErr } = await supabaseAdmin
      .from('referrals')
      .update({ status: 'REWARDED', rewarded_at: new Date().toISOString() })
      .eq('id', referral_id);

    if (updateErr) throw updateErr;

    // Credit referrer's wallet
    const rewardAmount = Number(referral.reward_amount || 0);
    if (rewardAmount > 0 && referral.role === 'customer') {
      try {
        // Try direct wallet upsert
        const { data: wallet } = await supabaseAdmin
          .from('customer_wallets')
          .select('id, balance')
          .eq('customer_id', referral.referrer_id)
          .single();

        if (wallet) {
          await supabaseAdmin
            .from('customer_wallets')
            .update({ balance: Number(wallet.balance) + rewardAmount })
            .eq('id', wallet.id);
        } else {
          await supabaseAdmin
            .from('customer_wallets')
            .insert({ customer_id: referral.referrer_id, balance: rewardAmount });
        }
      } catch (_) { /* non-fatal: wallet credit failed */ }
    }

    // Notify the referrer
    await dispatchNotification({
      userId: referral.referrer_id,
      type: 'REFERRAL_REWARDED',
      title: '🎉 Referral Reward Credited!',
      body: `Your referral has been verified! ₹${rewardAmount} has been credited to your account.`,
      data: { referral_id, reward_amount: rewardAmount.toString() },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
