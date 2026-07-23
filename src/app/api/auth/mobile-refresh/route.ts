import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import { createSession } from '@/lib/session';

/**
 * POST /api/auth/mobile-refresh
 *
 * Mobile-specific token refresh endpoint. Unlike the web version (/api/auth/refresh),
 * this route accepts the refresh token in the request body and returns new tokens
 * in the response body. The existing cookie-based /api/auth/refresh is unchanged.
 *
 * Body: { refreshToken: string }
 * Response: { token: string, refreshToken: string }
 */
export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { refreshToken } = body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json(
        { error: 'Missing refreshToken in request body' },
        { status: 400, headers: cacheHeaders }
      );
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
      return NextResponse.json(
        { error: 'Invalid or expired refresh token. Please log in again.' },
        { status: 401, headers: cacheHeaders }
      );
    }

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      await supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);

      return NextResponse.json(
        { error: 'Session expired. Please log in again.' },
        { status: 401, headers: cacheHeaders }
      );
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

      return NextResponse.json(
        { error: 'Account suspended or not found.' },
        { status: 403, headers: cacheHeaders }
      );
    }

    // Enforce max refresh limits (same policy as web)
    const maxRefreshes = user.role === 'worker' ? 300 : 500;
    if (session.refresh_count >= maxRefreshes) {
      await supabaseAdmin
        .from('sessions')
        .update({ is_active: false })
        .eq('id', session.id);

      return NextResponse.json(
        { error: 'Session refresh limit reached. Please log in again.' },
        { status: 401, headers: cacheHeaders }
      );
    }

    // Rotate: generate new access + refresh tokens
    const newSession = await createSession(
      {
        firebase_uid: user.firebase_uid,
        role: user.role as 'customer' | 'worker' | 'admin',
        user_id: user.id
      },
      session.auth_method,
      request,
      session.device_id
    );

    // Inactivate the old session (token rotation)
    await supabaseAdmin
      .from('sessions')
      .update({ is_active: false })
      .eq('id', session.id);

    // Return new tokens in body for mobile clients
    return NextResponse.json(
      {
        token: newSession.accessToken,
        refreshToken: newSession.refreshToken,
      },
      { headers: cacheHeaders }
    );
  } catch (err) {
    console.error('[Mobile Refresh] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: cacheHeaders }
    );
  }
}
