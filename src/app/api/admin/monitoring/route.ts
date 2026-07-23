import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    // Restrict access to administrators only
    await requireRole(request, 'admin');

    const uptime = process.uptime();
    const memory = process.memoryUsage();

    // Fetch security/system event logs from database
    const { data: recentEvents } = await supabaseAdmin
      .from('security_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    // Get active web/mobile sessions count
    const { count: activeSessionsCount } = await supabaseAdmin
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    return NextResponse.json({
      uptime,
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024)
      },
      activeSessions: activeSessionsCount || 0,
      recentEvents: recentEvents || [],
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate'
      }
    });

  } catch (error: any) {
    console.error('[Monitoring API] Error querying metrics:', error);
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
