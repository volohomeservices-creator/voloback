import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbStatus = 'CONNECTED';
  let dbError = null;

  try {
    // Perform a lightweight probe query to check Supabase DB connection state
    const { error } = await supabaseAdmin.from('users').select('id').limit(1);
    if (error) {
      dbStatus = 'DEGRADED';
      dbError = error.message;
    }
  } catch (err: any) {
    dbStatus = 'DISCONNECTED';
    dbError = err.message || err;
  }

  const memory = process.memoryUsage();

  return NextResponse.json({
    status: dbStatus === 'CONNECTED' ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      error: dbError
    },
    system: {
      memory: {
        rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(memory.external / 1024 / 1024)} MB`
      },
      nodeVersion: process.version,
      platform: process.platform
    }
  }, {
    status: dbStatus === 'CONNECTED' ? 200 : 500
  });
}
