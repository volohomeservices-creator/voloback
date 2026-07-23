import { workerLocationUpdateSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { processWorkerLocationUpdate } from '@/lib/tracking/location-service';

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    const validation = await validateBody(request, workerLocationUpdateSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;
    const { latitude, longitude, accuracy, speed, heading, deviceType } = body;

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ error: 'latitude and longitude are required' }, { status: 400 });
    }

    const result = await processWorkerLocationUpdate({
      workerId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      speed: speed !== undefined ? Number(speed) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      deviceType: (deviceType as "WEB" | "ANDROID" | "IOS") || 'WEB',
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[WorkerLocationAPI] Error processing location update:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
