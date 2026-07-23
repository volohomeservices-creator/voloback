import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase-server';

export interface SessionPayload {
  firebase_uid: string | null;
  role: 'customer' | 'worker' | 'admin';
  user_id: string; // Supabase users.id (UUID)
  iat?: number;
  exp?: number;
}

const getSecretKey = (): Uint8Array => {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    console.warn('[Session Security] Warning: SESSION_SECRET is missing from environment variables. Using fallback secret.');
    return new TextEncoder().encode('dev_session_secret_fallback_must_be_32_chars_long');
  }

  if (secret.length < 32 || secret.includes('placeholder')) {
    console.warn('[Session Security] Warning: SESSION_SECRET must be at least 32 characters long and not contain placeholders. Using fallback secret.');
    return new TextEncoder().encode('dev_session_secret_fallback_must_be_32_chars_long');
  }

  return new TextEncoder().encode(secret.trim());
};

const SESSION_CONFIG = {
  customer: {
    accessTokenTTL: 180 * 24 * 60 * 60,   // 180 days
    refreshTokenTTL: 180 * 24 * 60 * 60,  // 180 days
  },
  worker: {
    accessTokenTTL: 90 * 24 * 60 * 60,    // 90 days
    refreshTokenTTL: 90 * 24 * 60 * 60,   // 90 days
  },
  admin: {
    accessTokenTTL: 7 * 24 * 60 * 60,     // 7 days
    refreshTokenTTL: 7 * 24 * 60 * 60,    // 7 days
  }
};

/**
 * Creates a signed JWT access token. (Legacy function kept for backward compatibility).
 */
export async function createSessionCookie(payload: SessionPayload): Promise<string> {
  const token = await new SignJWT({
    firebase_uid: payload.firebase_uid,
    role: payload.role,
    user_id: payload.user_id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecretKey());

  // Attempt to write a database session entry as fallback
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const sessionsTable: any = supabaseAdmin.from('sessions');
    await sessionsTable.insert({
      user_id: payload.user_id,
      access_token_hash: tokenHash,
      refresh_token_hash: refreshTokenHash,
      device_id: null,
      ip_address: '127.0.0.1',
      user_agent: 'Legacy Session Admin',
      auth_method: 'legacy_cookie',
      is_active: true,
      expires_at: expiresAt.toISOString()
    });
  } catch (err) {
    console.error('Failed to log legacy session cookie in DB:', err);
  }

  return token;
}

/**
 * Creates an active database session and returns the access token JWT and refresh token.
 */
export async function createSession(
  payload: SessionPayload,
  authMethod: string,
  req?: Request,
  deviceId?: string
): Promise<{ accessToken: string; refreshToken: string; accessTokenTTL: number; refreshTokenTTL: number }> {
  const role = payload.role || 'customer';
  const config = SESSION_CONFIG[role as keyof typeof SESSION_CONFIG] || SESSION_CONFIG.customer;

  // 1. Generate access token JWT
  const accessToken = await new SignJWT({
    firebase_uid: payload.firebase_uid,
    role: payload.role,
    user_id: payload.user_id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTTL}s`)
    .sign(getSecretKey());

  // 2. Generate cryptographically random refresh token
  const refreshToken = crypto.randomBytes(32).toString('hex');

  // 3. Compute SHA-256 hashes for database storage
  const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // 4. Extract IP & user agent from request
  let ipAddress = '127.0.0.1';
  let userAgent = 'Unknown';
  if (req) {
    ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    // Split proxy lists
    if (ipAddress.includes(',')) {
      ipAddress = ipAddress.split(',')[0].trim();
    }
    userAgent = req.headers.get('user-agent') || 'Unknown';
  }

  const expiresAt = new Date(Date.now() + config.refreshTokenTTL * 1000);

  // 5. Save session to database
  const sessionsTable: any = supabaseAdmin.from('sessions');
  const { error } = await sessionsTable.insert({
    user_id: payload.user_id,
    access_token_hash: accessTokenHash,
    refresh_token_hash: refreshTokenHash,
    device_id: deviceId || null,
    ip_address: ipAddress,
    user_agent: userAgent,
    auth_method: authMethod,
    is_active: true,
    expires_at: expiresAt.toISOString(),
    last_activity: new Date().toISOString(),
    refresh_count: 0
  });

  if (error) {
    console.error('[Session Manager] Error creating session in database:', error);
    throw new Error('Failed to create session');
  }

  return {
    accessToken,
    refreshToken,
    accessTokenTTL: config.accessTokenTTL,
    refreshTokenTTL: config.refreshTokenTTL
  };
}

/**
 * Verifies a signed access token JWT and checks that the session remains active in the database.
 */
export async function verifySessionCookie(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256'],
    });
    const sessionPayload = payload as unknown as SessionPayload;

    // Compute access token hash to lookup in DB
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const sessionsTable: any = supabaseAdmin.from('sessions');
    const { data: session, error } = await sessionsTable
      .select('is_active, expires_at')
      .eq('access_token_hash', tokenHash)
      .maybeSingle();

    if (error || !session) {
      return null;
    }

    if (!session.is_active) {
      return null;
    }

    if (new Date(session.expires_at) < new Date()) {
      return null;
    }

    // Refresh last activity sliding window
    try {
      const sessionsTableUpdate: any = supabaseAdmin.from('sessions');
      await sessionsTableUpdate
        .update({ last_activity: new Date().toISOString() })
        .eq('access_token_hash', tokenHash);
    } catch {}

    return sessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Helper to record authentication events in auth_logs.
 */
export async function logAuthEvent(
  userId: string | null,
  phone: string | null,
  eventType: string,
  authMethod: string | null,
  req?: Request,
  deviceId?: string | null,
  metadata: any = {}
) {
  try {
    let ipAddress = '127.0.0.1';
    let userAgent = 'Unknown';
    if (req) {
      ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
      if (ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }
      userAgent = req.headers.get('user-agent') || 'Unknown';
    }

    const authLogsTable: any = supabaseAdmin.from('auth_logs');
    await authLogsTable.insert({
      user_id: userId,
      phone,
      event_type: eventType,
      auth_method: authMethod,
      ip_address: ipAddress,
      user_agent: userAgent,
      device_id: deviceId || null,
      metadata
    });
  } catch (err) {
    console.error('Error logging auth event:', err);
  }
}
