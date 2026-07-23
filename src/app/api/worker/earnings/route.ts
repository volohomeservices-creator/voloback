import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { startOfDay, startOfWeek, startOfMonth, format, parseISO, isWithinInterval } from 'date-fns';

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'week'; // today, week, month, custom
    const dateFrom = searchParams.get('date_from') || '';
    const dateTo = searchParams.get('date_to') || '';

    // Fetch all completed bookings for the worker
    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('id, total_amount, completed_at')
      .eq('worker_id', workerId)
      .eq('status', 'COMPLETED');

    if (error) throw error;

    const now = new Date();
    let startDate = startOfWeek(now, { weekStartsOn: 1 }); // Default to week

    if (period === 'today') {
      startDate = startOfDay(now);
    } else if (period === 'month') {
      startDate = startOfMonth(now);
    } else if (period === 'custom' && dateFrom) {
      startDate = parseISO(dateFrom);
    }

    const endDate = (period === 'custom' && dateTo) ? parseISO(dateTo) : now;

    // Filter bookings by date range
    const filteredBookings = (bookings || []).filter((b: any) => {
      if (!b.completed_at) return false;
      const completedDate = parseISO(b.completed_at);
      return isWithinInterval(completedDate, { start: startDate, end: endDate });
    });

    // Compute metrics
    let totalGross = 0;
    let completedJobsCount = filteredBookings.length;

    filteredBookings.forEach((b: any) => {
      totalGross += Number(b.total_amount);
    });

    const totalEarnings = Number((totalGross * 0.85).toFixed(2));
    const commissionDeducted = Number((totalGross * 0.15).toFixed(2));
    const averagePerJob = completedJobsCount > 0 ? Number((totalEarnings / completedJobsCount).toFixed(2)) : 0;

    // Build chart data
    const chartMap: Record<string, number> = {};

    if (period === 'today') {
      // Group by hours (e.g. 09:00, 10:00, etc.)
      filteredBookings.forEach((b: any) => {
        const hour = format(parseISO(b.completed_at), 'hh a');
        chartMap[hour] = (chartMap[hour] || 0) + Number((b.total_amount * 0.85).toFixed(2));
      });
    } else if (period === 'week') {
      // Group by days of week (Mon, Tue, etc.)
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      days.forEach(d => { chartMap[d] = 0; });
      filteredBookings.forEach((b: any) => {
        const dayName = format(parseISO(b.completed_at), 'eee');
        chartMap[dayName] = (chartMap[dayName] || 0) + Number((b.total_amount * 0.85).toFixed(2));
      });
    } else {
      // Group by date (e.g. Jun 08, Jun 09)
      filteredBookings.forEach((b: any) => {
        const dayStr = format(parseISO(b.completed_at), 'MMM dd');
        chartMap[dayStr] = (chartMap[dayStr] || 0) + Number((b.total_amount * 0.85).toFixed(2));
      });
    }

    const chartData = Object.entries(chartMap).map(([label, value]) => ({
      label,
      value: Number(value.toFixed(2))
    }));

    // Fetch actual database wallet balance for the worker
    let { data: wallet } = await supabaseAdmin
      .from('worker_wallets')
      .select('*')
      .eq('worker_id', workerId)
      .maybeSingle();

    if (!wallet) {
      // Auto-create wallet if it doesn't exist yet
      const { data: newWallet } = await supabaseAdmin
        .from('worker_wallets')
        .insert({ worker_id: workerId, balance: 0.00, minimum_balance: -500.00 })
        .select('*')
        .single();
      wallet = newWallet;
    }

    // Fetch last 20 wallet transactions
    const { data: txns } = await supabaseAdmin
      .from('wallet_transactions')
      .select('*')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      summary: {
        total: totalEarnings,
        jobsCount: completedJobsCount,
        average: averagePerJob,
        decay: false,
        commission: commissionDeducted
      },
      chartData,
      earnings: {
        balance: wallet ? Number(wallet.balance) : 0,
        minimum_balance: wallet ? Math.abs(Number(wallet.minimum_balance)) : 500
      },
      transactions: txns || []
    }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching worker earnings:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const amount = Number(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // 1. Get or create wallet
    let { data: wallet } = await supabaseAdmin
      .from('worker_wallets')
      .select('*')
      .eq('worker_id', workerId)
      .maybeSingle();

    if (!wallet) {
      const { data: newWallet } = await supabaseAdmin
        .from('worker_wallets')
        .insert({ worker_id: workerId, balance: 0.00, minimum_balance: -500.00 })
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
      .from('worker_wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('worker_id', workerId);

    if (updateErr) throw updateErr;

    // Log transaction
    await supabaseAdmin.from('wallet_transactions').insert({
      worker_id: workerId,
      amount: amount,
      type: 'TOPUP',
      description: `Topped up commission wallet by ₹${amount}`
    });

    return NextResponse.json({ success: true, balance: newBalance });
  } catch (error: any) {
    console.error('Error topping up worker wallet:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
