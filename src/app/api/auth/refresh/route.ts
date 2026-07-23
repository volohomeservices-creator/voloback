import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import { createSession, logAuthEvent } from '@/lib/session';

export async function POST(request: NextRequest) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const refreshToken = request.cookies.get('volo_refresh')?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token' }, { status: 401, headers: cacheHeaders });
    }

    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find the active session using the refresh token hash
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, user_id, expires_at, auth_method, refresh_count, device_id')
      .eq('refresh_token_hash', refreshTokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (sessionError || !session) {
      // Possible token theft / reuse of rotated refresh token
      await logAuthEvent(null, null, 'suspicious_activity', null, request, null, {
        reason: 'reuse_of_rotated_refresh_token',
        token_hash_prefix: refreshTokenHash.substring(0, 8)
      });
      return NextResponse.json({ error: 'Invalid refresh token. Please log in again.' }, { status: 401, headers: cacheHeaders });
    }

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);
        
      await logAuthEvent(session.user_id, null, 'session_expired', null, request, session.device_id);
      return NextResponse.json({ error: 'Session expired' }, { status: 401, headers: cacheHeaders });
    }

    // Query user to verify status and role
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active, is_suspended, phone, firebase_uid')
      .eq('id', session.user_id)
      .maybeSingle();

    if (userError || !user || !user.is_active || user.is_suspended) {
      await supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);

      return NextResponse.json({ error: 'Account suspended' }, { status: 403, headers: cacheHeaders });
    }

    // Enforce max refresh limits (e.g. 500 for customer, 300 for worker)
    const maxRefreshes = user.role === 'worker' ? 300 : 500;
    if (session.refresh_count >= maxRefreshes) {
      await supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);

      return NextResponse.json({ error: 'Session refresh limit reached. Please log in again.' }, { status: 401, headers: cacheHeaders });
    }

    // Rotate: generate new access + refresh tokens
    const newSession = await createSession(
      { firebase_uid: user.firebase_uid, role: user.role as 'customer' | 'worker' | 'admin', user_id: user.id },
      session.auth_method,
      request,
      session.device_id
    );

    // Inactivate the old session since we generated a rotated one (token rotation)
    await supabaseAdmin
      .from('sessions')
      .update({ is_active: false })
      .eq('id', session.id);

    // Success response
    const response = NextResponse.json({ success: true }, { headers: cacheHeaders });

    // Set rotated access token cookie
    response.cookies.set('volo_session', newSession.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: newSession.accessTokenTTL
    });

    // Set rotated refresh token cookie
    response.cookies.set('volo_refresh', newSession.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: newSession.refreshTokenTTL
    });

    // Log the refresh event
    await logAuthEvent(user.id, user.phone, 'session_refreshed', session.auth_method, request, session.device_id);

    return response;

  } catch (err) {
    console.error('[Refresh Session] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
