import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { verifyFirebaseToken } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase-server';
import { createSessionCookie } from '@/lib/session';
import { serialize } from 'cookie';

export async function POST(request: Request) {
  try {
    const { data: { idToken, role, ref_code }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!idToken || !role) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    if (role !== 'customer' && role !== 'worker') {
      return NextResponse.json({ error: 'UNAUTHORIZED_ROLE' }, { status: 400 });
    }

    // 1. Verify Firebase ID Token
    let firebase_uid: string;
    let phone: string;
    try {
      const decoded = await verifyFirebaseToken(idToken);
      firebase_uid = decoded.uid;
      phone = decoded.phone_number;
    } catch (err: any) {
      return NextResponse.json({ error: 'FIREBASE_TOKEN_INVALID' }, { status: 401 });
    }

    if (!phone) {
      return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 });
    }

    // 2. Query Existing User
    const { data: existingUser, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('firebase_uid', firebase_uid)
      .single();

    let user_id = '';
    let isNewUser = false;
    let current_full_name = '';
    let is_active = true;

    if (fetchErr && fetchErr.code === 'PGRST116') {
      // User does not exist under this firebase_uid, attempt to insert
      const { data: newUser, error: insertErr } = await supabaseAdmin
        .from('users')
        .insert({
          firebase_uid,
          phone,
          role,
          is_active: true
        })
        .select('*')
        .single();

      if (insertErr || !newUser) {
        console.error('[/api/auth/sync] Failed to insert new user record:', insertErr);
        // Fallback: look up user by phone number if phone number already exists
        const { data: userByPhone } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('phone', phone)
          .maybeSingle();

        if (userByPhone) {
          user_id = userByPhone.id;
          is_active = userByPhone.is_active;
          current_full_name = userByPhone.full_name || '';
          isNewUser = false;
          // Update firebase_uid on the existing user record
          await supabaseAdmin
            .from('users')
            .update({ firebase_uid })
            .eq('id', user_id);
        } else {
          return NextResponse.json({ error: 'Failed to create user record', details: insertErr?.message }, { status: 500 });
        }
      } else {
        isNewUser = true;
        user_id = newUser.id;
        is_active = newUser.is_active;
      }

      // If worker, insert workers table + commission wallet
      if (role === 'worker') {
        const { error: workerErr } = await supabaseAdmin
          .from('workers')
          .insert({
            id: user_id,
            status: 'OFFLINE',
            kyc_status: 'PENDING'
          });

        if (workerErr && workerErr.code !== '23505') {
          console.error('[/api/auth/sync] Failed to initialize worker profile:', workerErr);
          return NextResponse.json({ error: 'Failed to initialize worker profile', details: workerErr.message }, { status: 500 });
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
            .single();

          if (refCodeRow && refCodeRow.user_id !== user_id) {
            // Get the reward amount for this role
            const { data: settings } = await supabaseAdmin
              .from('referral_settings')
              .select('referrer_reward')
              .eq('role', refCodeRow.role)
              .eq('active', true)
              .single();

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
          // Non-fatal: log but don't block signup
          console.warn('Referral processing failed (non-fatal):', refErr);
        }
      }
    } else if (existingUser) {
      user_id = existingUser.id;
      is_active = existingUser.is_active;
      current_full_name = existingUser.full_name || '';

      // Check if role matches
      if (existingUser.role !== role) {
        return NextResponse.json({ error: 'UNAUTHORIZED_ROLE' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Database verification error' }, { status: 500 });
    }

    // 3. Verify Account Status
    if (!is_active) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403 });
    }

    // 4. Calculate Redirection
    let redirectTo = '';
    if (role === 'customer') {
      redirectTo = isNewUser || !current_full_name ? '/customer/onboarding' : '/customer/dashboard';
    } else {
      // Worker
      const { data: workerProfile } = await supabaseAdmin
        .from('workers')
        .select('kyc_status')
        .eq('id', user_id)
        .single();

      if (workerProfile?.kyc_status === 'REJECTED') {
        return NextResponse.json({ error: 'KYC_REJECTED' }, { status: 403 });
      }

      redirectTo = workerProfile?.kyc_status === 'APPROVED' ? '/worker/dashboard' : '/worker/kyc';
    }

    // 5. Generate and Set HttpOnly Session Cookie
    const sessionCookie = await createSessionCookie({
      firebase_uid,
      role,
      user_id
    });

    const serializedCookie = serialize('volo_session', sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    const existingPinHash = existingUser ? existingUser.pin_hash : null;

    const response = NextResponse.json({
      success: true,
      isNewUser,
      redirectTo,
      user: {
        id: user_id,
        role,
        full_name: current_full_name,
        phone
      },
      pinSet: !!existingPinHash,
      promptPinSetup: !existingPinHash
    });

    response.headers.set('Set-Cookie', serializedCookie);
    return response;
  } catch (error: any) {
    console.error('[/api/auth/sync] Error in sync api route:', error);
    return NextResponse.json({ error: 'Internal server error', details: error?.message || String(error) }, { status: 500 });
  }
}
