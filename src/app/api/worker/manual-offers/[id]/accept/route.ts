import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { acceptManualAssignmentOffer } from '@/lib/manual-assignment';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(request, 'worker');
    const { id: offerId } = await params;

    if (!offerId) {
      return NextResponse.json({ error: 'Missing offerId' }, { status: 400 });
    }

    const success = await acceptManualAssignmentOffer(offerId, session.user_id);

    if (!success) {
      return NextResponse.json({ error: 'Accept failed. Booking might be already taken.' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      message: 'Direct job offer accepted successfully'
    });

  } catch (error: any) {
    console.error('[Worker Accept API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
