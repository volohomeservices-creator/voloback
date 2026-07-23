import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionCookie } from '@/lib/session';
import { isRateLimited } from '@/lib/rate-limit';
import './env';
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  console.log(`[Proxy] Pathname: ${pathname}`);

  // CORS Handle
  const origin = req.headers.get('origin');
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
  const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim());
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  const isPreflight = req.method === 'OPTIONS';

  // SEC-003 Helper function for Security Headers
  const applySecurityHeaders = (headers: Headers) => {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    const isProd = process.env.NODE_ENV === 'production';
    const csp = isProd 
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;"
      : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https:;";
    headers.set('Content-Security-Policy', csp);
  };

  if (isPreflight) {
    const preflightHeaders = new Headers();
    if (isAllowedOrigin) {
      preflightHeaders.set('Access-Control-Allow-Origin', origin);
      preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      preflightHeaders.set('Access-Control-Allow-Origin', '*');
    } else {
      return new NextResponse(null, { status: 403, statusText: 'Forbidden' });
    }
    
    preflightHeaders.set('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
    preflightHeaders.set('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    
    // Apply Security Headers to Preflight too
    applySecurityHeaders(preflightHeaders);
    
    return new NextResponse(null, { headers: preflightHeaders, status: 200 });
  }

  // Helper to return redirect response with no-store cache headers to prevent browser redirect caching
  const redirectNoCache = (url: URL | string) => {
    const targetUrl = typeof url === 'string' ? url : url.toString();
    console.log(`[Proxy] Redirecting ${pathname} -> ${targetUrl}`);
    const response = NextResponse.redirect(typeof url === 'string' ? new URL(url, req.url) : url);
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return response;
  };

  if (
    pathname.startsWith('/admin/login') ||
    pathname.startsWith('/worker/login') ||
    pathname.startsWith('/customer/login') ||
    pathname.startsWith('/blocked') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/manifest.webmanifest') ||
    pathname.startsWith('/api')
  ) {
    console.log(`[Proxy] Bypassing path: ${pathname}`);
    const res = NextResponse.next();
    if (isAllowedOrigin) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    
    // Apply Security Headers
    applySecurityHeaders(res.headers);
    
    // SEC-004: Apply global rate limiting for API requests here
    if (pathname.startsWith('/api')) {
      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
      // Use existing isRateLimited function (allow 100 requests per minute per IP for generic API)
      const limit = await isRateLimited(ip, 'global_api', 100, 60);
      if (limit.limited) {
         const blockedResponse = NextResponse.json(
           { error: 'Too Many Requests' },
           { status: 429 }
         );
         blockedResponse.headers.set('Retry-After', limit.blockedUntil ? Math.ceil((limit.blockedUntil.getTime() - Date.now()) / 1000).toString() : '60');
         applySecurityHeaders(blockedResponse.headers);
         if (isAllowedOrigin) {
           blockedResponse.headers.set('Access-Control-Allow-Origin', origin);
           blockedResponse.headers.set('Access-Control-Allow-Credentials', 'true');
         }
         return blockedResponse;
      }
    }

    return res;
  }

  // 2. Read session cookie
  const sessionToken = req.cookies.get('volo_session')?.value;
  console.log(`[Proxy] Session cookie present: ${!!sessionToken}`);

  // 3. Handle unauthenticated requests
  if (!sessionToken) {
    console.log(`[Proxy] Unauthenticated request to ${pathname}`);
    if (pathname.startsWith('/api')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } }
      );
    }
    if (pathname.startsWith('/admin')) {
      return redirectNoCache(new URL('/admin/login', req.url));
    }
    if (pathname.startsWith('/worker')) {
      return redirectNoCache(new URL('/worker/login', req.url));
    }
    if (pathname.startsWith('/customer')) {
      return redirectNoCache(new URL('/customer/login', req.url));
    }
    const res = NextResponse.next();
    if (isAllowedOrigin) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return res;
  }

  // 4. Verify Session Payload
  const session = await verifySessionCookie(sessionToken);
  console.log(`[Proxy] Session verification result:`, session);

  if (!session) {
    console.log(`[Proxy] Invalid session token for ${pathname}`);
    if (pathname.startsWith('/api')) {
      const response = NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } }
      );
      response.cookies.delete('volo_session');
      return response;
    }
    const redirectUrl = pathname.startsWith('/admin')
      ? '/admin/login'
      : pathname.startsWith('/worker')
      ? '/worker/login'
      : '/customer/login';

    const response = redirectNoCache(new URL(redirectUrl, req.url));
    response.cookies.delete('volo_session');
    return response;
  }

  // 5. Role validation & routing redirection
  const { role } = session;
  console.log(`[Proxy] User Role: ${role}`);

  if (pathname.startsWith('/api')) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } }
    );
  }

  if (pathname.startsWith('/admin') && role !== 'admin') {
    const fallback = role === 'worker' ? '/worker/dashboard' : '/customer/dashboard';
    return redirectNoCache(new URL(fallback, req.url));
  }

  if (pathname.startsWith('/worker') && role !== 'worker') {
    const fallback = role === 'admin' ? '/admin/dashboard' : '/customer/dashboard';
    return redirectNoCache(new URL(fallback, req.url));
  }

  if (pathname.startsWith('/customer') && role !== 'customer') {
    const fallback = role === 'admin' ? '/admin/dashboard' : '/worker/dashboard';
    return redirectNoCache(new URL(fallback, req.url));
  }

  console.log(`[Proxy] Allowed path: ${pathname}`);
  const finalRes = NextResponse.next();
  if (isAllowedOrigin) {
    finalRes.headers.set('Access-Control-Allow-Origin', origin);
    finalRes.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  
  applySecurityHeaders(finalRes.headers);
  return finalRes;
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/worker/:path*',
    '/customer/:path*',
    '/api/:path*'
  ]
};

