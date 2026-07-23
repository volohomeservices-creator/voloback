import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { getManualAssignmentCandidates } from '@/lib/worker-ranking';
import { createManualAssignmentOffer } from '@/lib/manual-assignment';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    
    const { searchParams } = new URL(request.url);
    const bookingId = searchParams.get('bookingId');

    // 1. Fetch ALL Manual Assignment History for metrics and general lists
    const { data: allHistory, error: allErr } = await supabaseAdmin
      .from('manual_assignment_history')
      .select(`
        id,
        booking_id,
        worker_id,
        assigned_by,
        status,
        notes,
        expires_at,
        created_at,
        updated_at,
        workers (
          users (
            full_name,
            phone
          )
        ),
        assigned_by_user:users!manual_assignment_history_assigned_by_fkey (
          full_name
        )
      `)
      .order('created_at', { ascending: false });

    if (allErr) {
      console.error('[Manual Assign API] Error fetching all history:', allErr);
    }

    const historyItems = (allHistory || []) as any[];

    // Calculate Metrics (Update 8)
    const totalOffers = historyItems.length;
    const acceptedOffers = historyItems.filter(h => h.status === 'ACCEPTED').length;
    const rejectedOffers = historyItems.filter(h => h.status === 'REJECTED').length;
    const expiredOffersCount = historyItems.filter(h => h.status === 'EXPIRED').length;
    const reassignedOffers = historyItems.filter(h => h.status === 'REASSIGNED').length;

    const rateDivisor = totalOffers - reassignedOffers;
    const successRate = rateDivisor > 0 ? Math.round((acceptedOffers / rateDivisor) * 100) : 0;

    const respondedOffers = historyItems.filter(h => ['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(h.status));
    let averageResponseTimeMins = 0;
    if (respondedOffers.length > 0) {
      const totalDiffMs = respondedOffers.reduce((acc, curr) => {
        const diff = new Date(curr.updated_at).getTime() - new Date(curr.created_at).getTime();
        return acc + Math.max(0, diff);
      }, 0);
      averageResponseTimeMins = Number(((totalDiffMs / respondedOffers.length) / 60000).toFixed(1));
    }

    const metrics = {
      total: totalOffers,
      accepted: acceptedOffers,
      rejected: rejectedOffers,
      expired: expiredOffersCount,
      reassigned: reassignedOffers,
      successRate,
      averageResponseTimeMins
    };

    // Filter Expired offers list (Update 7)
    const expiredOffers = historyItems.filter(h => h.status === 'EXPIRED').map((h: any) => ({
      id: h.id,
      bookingId: h.booking_id,
      workerName: h.workers?.users?.full_name || 'Worker',
      workerPhone: h.workers?.users?.phone || '',
      assignedByName: h.assigned_by_user?.full_name || 'Admin',
      expiredAt: h.expires_at || h.updated_at,
      notes: h.notes
    }));

    // If bookingId is omitted, return global dashboard data
    if (!bookingId) {
      return NextResponse.json({
        success: true,
        metrics,
        expiredOffers
      });
    }

    // 2. Fetch Queue Information for specific booking
    const { data: queue } = await supabaseAdmin
      .from('assignment_queue')
      .select('status, attempts, current_group, started_at, created_at')
      .eq('booking_id', bookingId)
      .single();

    // Fetch worker rejections for this booking to map rejection reason notes
    const { data: rejections } = await supabaseAdmin
      .from('worker_job_rejections')
      .select('worker_id, reason')
      .eq('booking_id', bookingId);

    // 3. Filter history for this specific booking
    const specificHistory = historyItems.filter(h => h.booking_id === bookingId).map((h: any) => {
      const rej = ((rejections || []) as any[]).find(r => r.worker_id === h.worker_id);
      return {
        id: h.id,
        workerId: h.worker_id,
        workerName: h.workers?.users?.full_name || 'Worker',
        workerPhone: h.workers?.users?.phone || '',
        status: h.status,
        notes: h.notes,
        rejectionReason: rej ? rej.reason : null,
        expires_at: h.expires_at,
        created_at: h.created_at
      };
    });

    // 4. Get Ranked Candidate Workers
    const candidates = await getManualAssignmentCandidates(bookingId);

    return NextResponse.json({
      success: true,
      queueStatus: queue?.status || 'NOT_STARTED',
      attempts: queue?.attempts || 0,
      history: specificHistory,
      candidates,
      metrics
    });

  } catch (error: any) {
    console.error('[Manual Assign GET API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { bookingId, workerId, notes } = body;

    if (!bookingId || !workerId) {
      return NextResponse.json({ error: 'Missing required parameters bookingId or workerId' }, { status: 400 });
    }

    const offerId = await createManualAssignmentOffer(
      bookingId,
      workerId,
      session.user_id,
      notes
    );

    return NextResponse.json({
      success: true,
      offerId,
      message: 'Manual assignment offer dispatched successfully'
    });

  } catch (error: any) {
    console.error('[Manual Assign POST API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
