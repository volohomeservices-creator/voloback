import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { markReadyForPayout } from '@/lib/settlement-engine';

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { batchId } = body;

    if (!batchId) {
      return NextResponse.json({ error: 'Missing batchId' }, { status: 400 });
    }

    const result = await markReadyForPayout(batchId, session.user_id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
