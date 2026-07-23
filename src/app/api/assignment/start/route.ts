import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { startAssignment } from '@/lib/assignment-engine';

export async function POST(request: Request) {
  try {
    let authorized = false;
    
    // 1. Attempt admin check first
    try {
      const session = await requireRole(request, 'admin');
      if (session) authorized = true;
    } catch (err) {
      // Admin check failed, check internal secret header next
    }

    // 2. Fallback to internal secret header
    if (!authorized) {
      const secretHeader = request.headers.get('x-internal-secret');
      const expectedSecret = process.env.INTERNAL_SECRET || process.env.CRON_SECRET;
      
      if (secretHeader && expectedSecret && secretHeader === expectedSecret) {
        authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: { bookingId }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const result = await startAssignment(bookingId);

    return NextResponse.json({
      success: true,
      queueId: result,
      status: result === 'NO_WORKERS' ? 'MANUAL_REQUIRED' : 'BROADCASTING'
    });
  } catch (error: any) {
    console.error('Error in /api/assignment/start:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
