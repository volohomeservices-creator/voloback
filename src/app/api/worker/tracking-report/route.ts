import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getWorkerTrackingReport } from '@/lib/tracking/tracking-reporting';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const report = await getWorkerTrackingReport(workerId);
    return NextResponse.json({ report });
  } catch (error: any) {
    console.error('[WorkerTrackingReportAPI] Error fetching report:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
