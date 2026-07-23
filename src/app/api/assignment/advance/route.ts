import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { startAssignment, advanceAssignment } from '@/lib/assignment-engine';

export async function POST(request: Request) {
  try {
    // 1. Verify CRON_SECRET header
    const cronSecret = process.env.CRON_SECRET;
    const clientSecret = request.headers.get('x-cron-secret');

    // Only enforce if CRON_SECRET is configured
    if (cronSecret && clientSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    // 2. Query up to 50 queues needing advancement
    // We select:
    // - status = 'BROADCASTING' AND group_expires_at < NOW()
    // - OR status = 'QUEUED' AND group_expires_at < NOW()
    const { data: expiredQueues, error: queryErr } = await supabaseAdmin
      .from('assignment_queue')
      .select('id, booking_id, status, group_expires_at')
      .or(`and(status.eq.BROADCASTING,group_expires_at.lt.${nowIso}),and(status.eq.QUEUED,group_expires_at.lt.${nowIso})`)
      .limit(50);

    if (queryErr) {
      console.error('Error querying expired queues:', queryErr);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    let processed = 0;
    let advanced = 0;
    let manual_required = 0;
    const errors: string[] = [];

    // 3. Process each queue item
    for (const queue of expiredQueues || []) {
      try {
        processed++;
        if (queue.status === 'QUEUED') {
          // Scheduled booking ready to start
          await startAssignment(queue.booking_id);
          advanced++;
        } else if (queue.status === 'BROADCASTING') {
          // Group timed out, advance group
          const result = await advanceAssignment(queue.id);
          if (result === 'ADVANCED') {
            advanced++;
          } else if (result === 'MANUAL_REQUIRED') {
            manual_required++;
          }
        }
      } catch (err: any) {
        console.error(`Error advancing queue ${queue.id}:`, err);
        errors.push(`Queue ${queue.id}: ${err.message || err}`);
      }
    }

    return NextResponse.json({
      processed,
      advanced,
      manual_required,
      errors
    });
  } catch (error: any) {
    console.error('Error in /api/assignment/advance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
