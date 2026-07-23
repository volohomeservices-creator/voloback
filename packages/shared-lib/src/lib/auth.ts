import { NextRequest } from 'next/server';
import { parse } from 'cookie';
import { verifySessionCookie, SessionPayload } from './session';

export async function getSessionFromRequest(req: Request | NextRequest): Promise<SessionPayload | null> {
  // 1. Check Authorization: Bearer header (mobile app bearer token transport)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.substring(7).trim();
    if (bearerToken) {
      return verifySessionCookie(bearerToken);
    }
  }

  // 2. Fallback: cookie-based auth (web app)
  if ('cookies' in req && typeof req.cookies.get === 'function') {
    const cookieVal = req.cookies.get('volo_session')?.value;
    if (cookieVal) {
      return verifySessionCookie(cookieVal);
    }
  }

  const cookieHeader = req.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const token = cookies['volo_session'];
  if (!token) {
    return null;
  }
  return verifySessionCookie(token);
}

export async function requireSession(req: Request | NextRequest): Promise<SessionPayload> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    const err = new Error('UNAUTHORIZED');
    (err as any).status = 401;
    throw err;
  }
  return session;
}

export async function requireRole(
  req: Request | NextRequest,
  role: 'customer' | 'worker' | 'admin'
): Promise<SessionPayload> {
  const session = await requireSession(req);
  if (session.role !== role) {
    const err = new Error('FORBIDDEN');
    (err as any).status = 403;
    throw err;
  }
  return session;
}
