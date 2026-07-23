import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

function generateCode(name: string): string {
  const namePart = name.replace(/\s+/g, '').substring(0, 4).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `VOLOWK-${namePart}-${rand}`;
}

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const userId = session.user_id;

    // 1. Get or create referral code
    let { data: codeRow } = await supabaseAdmin
      .from('referral_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('role', 'worker')
      .single();

    if (!codeRow) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', userId)
        .single();

      const code = generateCode(user?.full_name || 'WRK');
      const { data: newCode } = await supabaseAdmin
        .from('referral_codes')
        .insert({ user_id: userId, referral_code: code, role: 'worker' })
        .select()
        .single();
      codeRow = newCode;
    }

    // 2. Get referral stats
    const { data: referrals } = await supabaseAdmin
      .from('referrals')
      .select('id, status, reward_amount, created_at')
      .eq('referrer_id', userId)
      .eq('role', 'worker')
      .order('created_at', { ascending: false });

    const successCount = (referrals || []).filter(r => r.status === 'REWARDED').length;
    const pendingCount = (referrals || []).filter(r => r.status === 'PENDING' || r.status === 'QUALIFIED').length;
    const totalEarned = (referrals || [])
      .filter(r => r.status === 'REWARDED')
      .reduce((sum, r) => sum + Number(r.reward_amount || 0), 0);
    const pendingAmount = (referrals || [])
      .filter(r => r.status === 'QUALIFIED')
      .reduce((sum, r) => sum + Number(r.reward_amount || 0), 0);

    // 3. Get reward settings
    const { data: settings } = await supabaseAdmin
      .from('referral_settings')
      .select('referrer_reward, referee_reward, min_bookings_to_qualify')
      .eq('role', 'worker')
      .eq('active', true)
      .single();

    return NextResponse.json({
      code: codeRow?.referral_code || null,
      referrals: referrals || [],
      stats: {
        successCount,
        pendingCount,
        totalEarned,
        pendingAmount,
      },
      settings: settings || { referrer_reward: 500, referee_reward: 0, min_bookings_to_qualify: 5 },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
