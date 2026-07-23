import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyFirebaseToken } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-server';
import { createSession, logAuthEvent } from '@/lib/session';

export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const { data: { idToken, role, ref_code, deviceFingerprint, deviceName }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!idToken || !role) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400, headers: cacheHeaders });
    }

    if (role !== 'customer' && role !== 'worker') {
      return NextResponse.json({ error: 'UNAUTHORIZED_ROLE' }, { status: 400, headers: cacheHeaders });
    }

    // 1. Verify Firebase ID Token
    let firebase_uid: string;
    let phone: string;
    try {
      const decoded = await verifyFirebaseToken(idToken);
      firebase_uid = decoded.uid;
      phone = decoded.phone_number;
    } catch (err: any) {
      return NextResponse.json({ error: 'FIREBASE_TOKEN_INVALID' }, { status: 401, headers: cacheHeaders });
    }

    if (!phone) {
      return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400, headers: cacheHeaders });
    }

    // E.164 phone normalization
    const formattedPhone = phone.startsWith('+91') ? phone : `+91${phone}`;

    // 2. Query Existing User
    const { data: existingUser, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone', formattedPhone)
      .maybeSingle();

    let user_id = '';
    let isNewUser = false;
    let current_full_name = '';
    let is_active = true;
    let is_suspended = false;
    let existing_pin_hash = null;

    if (!existingUser) {
      // User does not exist, insert user
      isNewUser = true;
      const { data: newUser, error: insertErr } = await supabaseAdmin
        .from('users')
        .insert({
          firebase_uid,
          phone: formattedPhone,
          role,
          phone_verified: true,
          is_active: true,
          is_suspended: false,
          last_login_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (insertErr || !newUser) {
        console.error('[Verify Token] Failed to create user:', insertErr);
        return NextResponse.json({ error: 'Failed to create user record' }, { status: 500, headers: cacheHeaders });
      }

      user_id = newUser.id;
      is_active = newUser.is_active;

      // If worker, insert workers table
      if (role === 'worker') {
        const { error: workerErr } = await supabaseAdmin
          .from('workers')
          .insert({
            id: user_id,
            status: 'OFFLINE',
            kyc_status: 'PENDING'
          });

        if (workerErr) {
          console.error('[Verify Token] Failed to initialize worker profile:', workerErr);
          return NextResponse.json({ error: 'Failed to initialize worker profile' }, { status: 500, headers: cacheHeaders });
        }
      }

      // Process referral code if provided on signup
      if (ref_code && typeof ref_code === 'string') {
        try {
          const { data: refCodeRow } = await supabaseAdmin
            .from('referral_codes')
            .select('user_id, role')
            .eq('referral_code', ref_code.trim().toUpperCase())
            .eq('active', true)
            .maybeSingle();

          if (refCodeRow && refCodeRow.user_id !== user_id) {
            const { data: settings } = await supabaseAdmin
              .from('referral_settings')
              .select('referrer_reward')
              .eq('role', refCodeRow.role)
              .eq('active', true)
              .maybeSingle();

            await supabaseAdmin
              .from('referrals')
              .insert({
                referrer_id: refCodeRow.user_id,
                referred_user_id: user_id,
                referral_code: ref_code.trim().toUpperCase(),
                role: refCodeRow.role,
                status: 'PENDING',
                reward_amount: settings?.referrer_reward || 500,
              });
          }
        } catch (refErr) {
          console.warn('Referral processing failed (non-fatal):', refErr);
        }
      }
    } else {
      user_id = existingUser.id;
      is_active = existingUser.is_active;
      is_suspended = existingUser.is_suspended || false;
      current_full_name = existingUser.full_name || '';
      existing_pin_hash = existingUser.pin_hash;

      // Check if role matches
      if (existingUser.role !== role) {
        return NextResponse.json({ error: 'UNAUTHORIZED_ROLE' }, { status: 403, headers: cacheHeaders });
      }
    }

    // 3. Verify Account Status
    if (!is_active || is_suspended) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403, headers: cacheHeaders });
    }

    // 4. Register this as a trusted device
    const deviceToken = crypto.randomUUID();
    const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

    // Execute user update (if existing user) and trusted devices fetch in parallel
    let devices: any[] | null = null;
    let devFetchErr: any = null;

    if (!existingUser) {
      const { data, error } = await supabaseAdmin
        .from('trusted_devices')
        .select('id')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .order('last_used_at', { ascending: true });
      devices = data;
      devFetchErr = error;
    } else {
      const updatePromise = supabaseAdmin
        .from('users')
        .update({
          firebase_uid,
          phone_verified: true,
          last_login_at: new Date().toISOString()
        })
        .eq('id', user_id);

      const devicesFetchPromise = supabaseAdmin
        .from('trusted_devices')
        .select('id')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .order('last_used_at', { ascending: true });

      const [_, fetchRes] = await Promise.all([updatePromise, devicesFetchPromise]);
      devices = fetchRes.data;
      devFetchErr = fetchRes.error;
    }

    if (!devFetchErr && devices && devices.length >= 3) {
      // Enforce max 3 active devices per user. To add 1 new device,
      // we must have at most 2 existing active devices.
      const deactivateCount = devices.length - 2;
      const deviceIdsToDeactivate = devices.slice(0, deactivateCount).map(d => d.id);
      await supabaseAdmin
        .from('trusted_devices')
        .update({ is_active: false })
        .in('id', deviceIdsToDeactivate);
    }

    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
    const { data: newDevice } = await supabaseAdmin
      .from('trusted_devices')
      .insert({
        user_id,
        device_token_hash: deviceTokenHash,
        device_fingerprint: deviceFingerprint || null,
        device_name: deviceName || 'Unknown Device',
        ip_address: clientIp,
        is_active: true
      })
      .select('id')
      .single();

    // 5. Create session (access + refresh tokens)
    const session = await createSession(
      { firebase_uid, role, user_id },
      'firebase_otp',
      request,
      newDevice?.id
    );

    // 6. Calculate Redirection
    let redirectTo = '';
    if (role === 'customer') {
      redirectTo = isNewUser || !current_full_name ? '/customer/onboarding' : '/customer/dashboard';
    } else {
      // Worker
      const { data: workerProfile } = await supabaseAdmin
        .from('workers')
        .select('kyc_status')
        .eq('id', user_id)
        .maybeSingle();

      if (workerProfile?.kyc_status === 'REJECTED') {
        return NextResponse.json({ error: 'KYC_REJECTED' }, { status: 403, headers: cacheHeaders });
      }

      redirectTo = workerProfile?.kyc_status === 'APPROVED' ? '/worker/dashboard' : '/worker/kyc';
    }

    // 7. Log auth events (asynchronously, do not block response)
    Promise.all([
      logAuthEvent(user_id, formattedPhone, 'otp_verified', 'firebase_otp', request, newDevice?.id),
      logAuthEvent(user_id, formattedPhone, 'device_registered', 'firebase_otp', request, newDevice?.id)
    ]).catch(err => {
      console.error('[Verify Token] Failed logging auth events (non-fatal):', err);
    });

    // 8. Return response and set cookies
    // NOTE: token + refreshToken are included in the JSON body for mobile clients.
    // Web clients ignore these and rely on the httpOnly cookies set below.
    const response = NextResponse.json({
      success: true,
      isNewUser,
      redirectTo,
      token: session.accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: user_id,
        role,
        full_name: current_full_name,
        phone: formattedPhone
      },
      deviceToken,
      pinSet: !!existing_pin_hash,
      promptPinSetup: !existing_pin_hash
    }, { headers: cacheHeaders });

    // Set short-lived Access Token cookie (15 min)
    response.cookies.set('volo_session', session.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: session.accessTokenTTL
    });

    // Set long-lived Refresh Token cookie (restricted path `/api/auth/refresh`)
    response.cookies.set('volo_refresh', session.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: session.refreshTokenTTL
    });

    return response;

  } catch (error) {
    console.error('[Verify Token] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
