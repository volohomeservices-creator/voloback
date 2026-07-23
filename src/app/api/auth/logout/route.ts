import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSessionFromRequest } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await getSessionFromRequest(request);

    if (session) {
      const accessToken = request.cookies.get('volo_session')?.value;
      if (accessToken) {
        const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
        // Deactivate session in DB
        await supabaseAdmin
          .from('sessions')
          .update({ is_active: false })
          .eq('access_token_hash', tokenHash);
      }
    }

    const response = NextResponse.json({ success: true }, { headers: cacheHeaders });
    
    // Clear cookies
    response.cookies.delete('volo_session');
    response.cookies.delete('volo_refresh');

    return response;
  } catch (err) {
    console.error('[Logout] Error processing logout:', err);
    const response = NextResponse.json({ success: true }, { headers: cacheHeaders });
    response.cookies.delete('volo_session');
    response.cookies.delete('volo_refresh');
    return response;
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
