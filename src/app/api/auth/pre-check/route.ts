import { preCheckSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import { isRateLimited } from '@/lib/rate-limit';
import { verifyRecaptchaToken } from '@/lib/recaptcha-server';

export async function POST(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const validation = await validateBody(request, preCheckSchema);
    if (!validation.success) return validation.errorResponse;
    const { phone, deviceToken, recaptchaToken } = validation.data;

    // Verify reCAPTCHA token
    const recaptchaResult = await verifyRecaptchaToken(recaptchaToken, 'LOGIN');
    if (!recaptchaResult.success) {
      return NextResponse.json(
        { error: `Verification failed. Please try again. Reason: ${recaptchaResult.reason}` }, 
        { status: 400, headers: cacheHeaders }
      );
    }

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400, headers: cacheHeaders });
    }

    // Standardize E.164 phone formatting
    const formattedPhone = phone.startsWith('+91') ? phone : `+91${phone}`;

    // Rate limit pre-check attempts to prevent user/phone enumeration and bot abuse
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
    const limitIpResult = await isRateLimited(ip, 'pre_check_ip', 60, 3600);
    const limitPhoneResult = await isRateLimited(formattedPhone, 'pre_check_phone', 20, 3600);

    if (limitIpResult.limited || limitPhoneResult.limited) {
      const blockedUntil = limitPhoneResult.blockedUntil || limitIpResult.blockedUntil;
      const minutesLeft = blockedUntil ? Math.ceil((blockedUntil.getTime() - Date.now()) / 60000) : 15;
      return NextResponse.json(
        { error: `Too many attempts. Please retry in ${minutesLeft} minutes.` },
        { status: 429, headers: cacheHeaders }
      );
    }

    // Query user from database
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, is_active, is_suspended, pin_hash')
      .eq('phone', formattedPhone)
      .maybeSingle();

    if (error) {
      console.error('[Pre-Check] DB error querying user:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
    }

    if (!user) {
      // User doesn't exist, must register via OTP
      return NextResponse.json({
        authMethod: 'otp_required',
        isRegistered: false,
        hasEmail: false
      }, { headers: cacheHeaders });
    }

    // Check if account is active and not suspended
    if (!user.is_active || user.is_suspended) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403, headers: cacheHeaders });
    }

    const hasEmail = !!user.email;

    // If they have a PIN set, always require PIN login to avoid redundant OTP requests.
    if (user.pin_hash) {
      return NextResponse.json({
        authMethod: 'pin_required',
        isRegistered: true,
        hasEmail
      }, { headers: cacheHeaders });
    }

    // Check if device token matches a registered trusted device
    if (deviceToken) {
      const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
      const { data: device, error: deviceError } = await supabaseAdmin
        .from('trusted_devices')
        .select('id, is_active')
        .eq('user_id', user.id)
        .eq('device_token_hash', deviceTokenHash)
        .eq('is_active', true)
        .maybeSingle();

      if (!deviceError && device && device.is_active) {
        return NextResponse.json({
          authMethod: 'trusted_device',
          isRegistered: true,
          hasEmail
        }, { headers: cacheHeaders });
      }
    }

    // Default back to OTP login for untrusted devices without a PIN
    return NextResponse.json({
      authMethod: 'otp_required',
      isRegistered: true,
      hasEmail
    }, { headers: cacheHeaders });

  } catch (err) {
    console.error('[Pre-Check] Unhandled exception:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}
