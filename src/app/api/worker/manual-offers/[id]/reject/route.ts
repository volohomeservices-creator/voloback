import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { rejectManualAssignmentOffer } from '@/lib/manual-assignment';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'worker');
    const { id: offerId } = await params;
    const { data: { reason }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!offerId) {
      return NextResponse.json({ error: 'Missing offerId' }, { status: 400 });
    }

    await rejectManualAssignmentOffer(offerId, session.user_id, reason);

    return NextResponse.json({
      success: true,
      message: 'Direct job offer rejected successfully'
    });

  } catch (error: any) {
    console.error('[Worker Reject API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
