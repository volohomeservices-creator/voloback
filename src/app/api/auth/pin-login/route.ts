import { pinLoginSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import bcryptjs from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { isRateLimited } from '@/lib/rate-limit';
import { createSession, logAuthEvent } from '@/lib/session';
import { verifyRecaptchaToken } from '@/lib/recaptcha-server';

export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const validation = await validateBody(request, pinLoginSchema);
    if (!validation.success) return validation.errorResponse;
    const { phone, pin, recaptchaToken } = validation.data;

    // Verify reCAPTCHA token
    const recaptchaResult = await verifyRecaptchaToken(recaptchaToken, 'LOGIN');
    if (!recaptchaResult.success) {
      return NextResponse.json(
        { success: false, error: `Verification failed. Please try again. Reason: ${recaptchaResult.reason}` }, 
        { status: 400, headers: cacheHeaders }
      );
    }

    if (!phone || !pin) {
      return NextResponse.json({ success: false, error: 'Missing phone or PIN' }, { status: 400, headers: cacheHeaders });
    }

    const formattedPhone = phone.startsWith('+91') ? phone : `+91${phone}`;

    // 1. Rate limiting PIN login attempts (bypassed in development mode)
    if (process.env.NODE_ENV === 'production') {
      const limitPhoneResult = await isRateLimited(formattedPhone, 'pin_attempt', 5, 3600);
      if (limitPhoneResult.limited) {
        const minutesLeft = limitPhoneResult.blockedUntil ? Math.ceil((limitPhoneResult.blockedUntil.getTime() - Date.now()) / 60000) : 15;
        return NextResponse.json(
          { error: `Too many PIN attempts. Please retry in ${minutesLeft} minutes.` },
          { status: 429, headers: cacheHeaders }
        );
      }
    }

    const clean10Digits = phone.replace(/\D/g, '').slice(-10);
    const formattedPhone = `+91${clean10Digits}`;
    const phoneVariants = Array.from(new Set([phone, formattedPhone, clean10Digits]));

    // 2. Query user across phone variants
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .in('phone', phoneVariants)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401, headers: cacheHeaders });
    }

    if (!user.is_active || user.is_suspended) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403, headers: cacheHeaders });
    }

    if (!user.pin_hash) {
      return NextResponse.json({ success: false, error: 'PIN not configured for this account' }, { status: 400, headers: cacheHeaders });
    }

    // 3. Check PIN lockout
    const now = new Date();
    if (user.pin_locked_until && new Date(user.pin_locked_until) > now) {
      const minutesLeft = Math.ceil((new Date(user.pin_locked_until).getTime() - now.getTime()) / 60000);
      return NextResponse.json(
        { error: `PIN verification locked. Please retry in ${minutesLeft} minutes.` },
        { status: 429, headers: cacheHeaders }
      );
    }

    // 4. Verify PIN with Bcrypt
    const pinValid = await bcryptjs.compare(pin, user.pin_hash);

    if (!pinValid) {
      const newAttempts = (user.pin_attempts || 0) + 1;
      let lockUntil: Date | null = null;

      // Progressive lockout rules
      if (newAttempts >= 20) {
        lockUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000); // Permanent lockout (1 year)
      } else if (newAttempts >= 15) {
        lockUntil = new Date(Date.now() + 24 * 3600 * 1000);      // 24 hours
      } else if (newAttempts >= 10) {
        lockUntil = new Date(Date.now() + 3600 * 1000);           // 1 hour
      } else if (newAttempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000);        // 15 minutes
      }

      await supabaseAdmin
        .from('users')
        .update({
          pin_attempts: newAttempts,
          pin_locked_until: lockUntil ? lockUntil.toISOString() : null
        })
        .eq('id', user.id);

      logAuthEvent(user.id, formattedPhone, 'pin_failed', 'pin', request, null, {
        attempts: newAttempts,
        locked: !!lockUntil
      }).catch(err => console.error('[PIN Login] Logging error:', err));

      if (lockUntil) {
        logAuthEvent(user.id, formattedPhone, 'pin_locked', 'pin', request).catch(err => console.error('[PIN Login] Logging error:', err));
      }

      const remaining = Math.max(0, 5 - (newAttempts % 5));
      let message = 'Incorrect PIN.';
      if (lockUntil) {
        const minutes = newAttempts >= 15 ? (newAttempts >= 20 ? 'permanently' : '24 hours') : (newAttempts >= 10 ? '1 hour' : '15 minutes');
        message = `Incorrect PIN. Your account is locked for ${minutes}.`;
      } else if (remaining > 0) {
        message = `Incorrect PIN. ${remaining} attempts remaining before temporary lockout.`;
      }

      return NextResponse.json({ success: false, error: message }, { status: 401, headers: cacheHeaders });
    }

    // 5. PIN is correct: reset locks
    await supabaseAdmin
      .from('users')
      .update({
        pin_attempts: 0,
        pin_locked_until: null,
        last_login_at: now.toISOString()
      })
      .eq('id', user.id);

    // 6. Create session
    const session = await createSession(
      { firebase_uid: user.firebase_uid, role: user.role, user_id: user.id },
      'pin',
      request
    );

    // 7. Calculate Redirection
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

    // 8. Log success (asynchronously, do not block response)
    logAuthEvent(user.id, formattedPhone, 'pin_verified', 'pin', request).catch(err => console.error('[PIN Login] Logging error:', err));

    const response = NextResponse.json({
      success: true,
      token: session.accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name || '',
        phone: formattedPhone
      },
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
    console.error('[PIN Login] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
