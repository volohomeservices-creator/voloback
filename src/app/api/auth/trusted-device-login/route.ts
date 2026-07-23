import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import { isRateLimited } from '@/lib/rate-limit';
import { createSession, logAuthEvent } from '@/lib/session';

export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const { data: { phone, deviceToken, deviceFingerprint }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!phone || !deviceToken) {
      return NextResponse.json({ success: false, reason: 'missing_parameters' }, { status: 400, headers: cacheHeaders });
    }

    const formattedPhone = phone.startsWith('+91') ? phone : `+91${phone}`;

    // Rate Limit trusted device login attempts
    const limitPhoneResult = await isRateLimited(formattedPhone, 'device_login', 5, 3600);
    if (limitPhoneResult.limited) {
      const minutesLeft = limitPhoneResult.blockedUntil ? Math.ceil((limitPhoneResult.blockedUntil.getTime() - Date.now()) / 60000) : 15;
      return NextResponse.json(
        { error: `Too many attempts. Please retry in ${minutesLeft} minutes.` },
        { status: 429, headers: cacheHeaders }
      );
    }

    // Query user
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone', formattedPhone)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ success: false, reason: 'invalid' }, { status: 401, headers: cacheHeaders });
    }

    if (!user.is_active || user.is_suspended) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403, headers: cacheHeaders });
    }

    // Verify device token hash
    const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
    const { data: device, error: deviceError } = await supabaseAdmin
      .from('trusted_devices')
      .select('*')
      .eq('user_id', user.id)
      .eq('device_token_hash', deviceTokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (deviceError || !device) {
      logAuthEvent(user.id, formattedPhone, 'device_login_failed', 'trusted_device', request, null, {
        reason: 'device_not_recognized'
      }).catch(err => console.error('[Trusted Device Login] Logging error:', err));
      return NextResponse.json({ success: false, reason: 'device_not_recognized' }, { status: 401, headers: cacheHeaders });
    }

    // Log suspicious activity if fingerprint changed
    if (device.device_fingerprint && deviceFingerprint && device.device_fingerprint !== deviceFingerprint) {
      await supabaseAdmin.from('security_events').insert({
        user_id: user.id,
        event_type: 'device_anomaly',
        severity: 'medium',
        details: {
          reason: 'fingerprint_mismatch',
          old_fingerprint: device.device_fingerprint,
          new_fingerprint: deviceFingerprint
        }
      });
    }

    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';

    // Rotate device token to prevent replays
    const newDeviceToken = crypto.randomUUID();
    const newDeviceTokenHash = crypto.createHash('sha256').update(newDeviceToken).digest('hex');

    await supabaseAdmin
      .from('trusted_devices')
      .update({
        device_token_hash: newDeviceTokenHash,
        last_used_at: new Date().toISOString(),
        last_ip: clientIp
      })
      .eq('id', device.id);

    // Create session
    const session = await createSession(
      { firebase_uid: user.firebase_uid, role: user.role, user_id: user.id },
      'trusted_device',
      request,
      device.id
    );

    // Calculate redirection path
    let redirectTo = '';
    if (user.role === 'customer') {
      redirectTo = !user.full_name ? '/customer/onboarding' : '/customer/dashboard';
    } else {
      // Worker
      const { data: workerProfile } = await supabaseAdmin
        .from('workers')
        .select('kyc_status')
        .eq('id', user.id)
        .maybeSingle();

      if (workerProfile?.kyc_status === 'REJECTED') {
        return NextResponse.json({ error: 'KYC_REJECTED' }, { status: 403, headers: cacheHeaders });
      }

      redirectTo = workerProfile?.kyc_status === 'APPROVED' ? '/worker/dashboard' : '/worker/kyc';
    }

    // Log success (asynchronously, do not block response)
    logAuthEvent(user.id, formattedPhone, 'device_login', 'trusted_device', request, device.id, {
      status: 'success'
    }).catch(err => console.error('[Trusted Device Login] Logging error:', err));

    const response = NextResponse.json({
      success: true,
      newDeviceToken,
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name || '',
        phone: formattedPhone
      },
      pinSet: !!user.pin_hash,
      redirectTo
    }, { headers: cacheHeaders });

    // Set Access Token cookie (15 min)
    response.cookies.set('volo_session', session.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: session.accessTokenTTL
    });

    // Set Refresh Token cookie
    response.cookies.set('volo_refresh', session.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: session.refreshTokenTTL
    });

    return response;

  } catch (err) {
    console.error('[Trusted Device Login] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
