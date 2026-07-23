import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    let { data: availability, error } = await supabaseAdmin
      .from('worker_availability')
      .select('*')
      .eq('worker_id', workerId)
      .maybeSingle();

    if (error) throw error;

    // Auto-provision if missing
    if (!availability) {
      const { data: newAvail } = await supabaseAdmin
        .from('worker_availability')
        .insert({ worker_id: workerId })
        .select()
        .single();
      availability = newAvail || {};
    }

    return NextResponse.json({
      working_days: availability.working_days || [],
      start_time: availability.start_time || '09:00:00',
      end_time: availability.end_time || '18:00:00',
      vacation_mode: !!availability.vacation_mode,
      unavailable_dates: availability.unavailable_dates || []
    });
  } catch (error: any) {
    console.error('Error fetching worker availability:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    const {
      working_days,
      start_time,
      end_time,
      vacation_mode,
      unavailable_dates
    } = body;

    // 1. Update availability settings
    const { error: updateAvailErr } = await supabaseAdmin
      .from('worker_availability')
      .upsert({
        worker_id: workerId,
        working_days: working_days || [],
        start_time: start_time || '09:00:00',
        end_time: end_time || '18:00:00',
        vacation_mode: !!vacation_mode,
        unavailable_dates: unavailable_dates || [],
        updated_at: new Date().toISOString()
      });

    if (updateAvailErr) throw updateAvailErr;

    // 2. If vacation_mode is enabled, update status in workers table to VACATION immediately
    if (vacation_mode) {
      await supabaseAdmin
        .from('workers')
        .update({ status: 'VACATION' })
        .eq('id', workerId);
    } else {
      // Revert status to OFFLINE if it was VACATION and vacation mode is disabled
      const { data: worker } = await supabaseAdmin
        .from('workers')
        .select('status')
        .eq('id', workerId)
        .single();

      if (worker?.status === 'VACATION') {
        await supabaseAdmin
          .from('workers')
          .update({ status: 'OFFLINE' })
          .eq('id', workerId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating worker availability:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
