import { adminLoginSchema } from '@/lib/schemas';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { createSessionCookie } from '@/lib/session';
import bcryptjs from 'bcryptjs';
import { serialize } from 'cookie';
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const validation = await validateBody(request, adminLoginSchema);
    if (!validation.success) return validation.errorResponse;
    const body = validation.data;
    const parseResult = loginSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }

    const { email, password } = parseResult.data;

    // 1. Query Admin profile
    const { data: user, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('role', 'admin')
      .single();

    if (fetchErr || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED_ROLE' }, { status: 401 });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403 });
    }

    if (!user.password_hash) {
      return NextResponse.json({ error: 'ADMIN_WRONG_CREDS' }, { status: 401 });
    }

    // 2. Compare Bcrypt Passwords
    const match = await bcryptjs.compare(password, user.password_hash);
    if (!match) {
      return NextResponse.json({ error: 'ADMIN_WRONG_CREDS' }, { status: 401 });
    }

    // 3. Set Session Cookie
    const sessionCookie = await createSessionCookie({
      firebase_uid: null,
      role: 'admin',
      user_id: user.id
    });

    const serializedCookie = serialize('volo_session', sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    // Write Audit Log
    await logAuditAction({
      admin_id: user.id,
      action: AuditAction.ADMIN_LOGIN,
      target_type: 'user',
      target_id: user.id,
      metadata: { email: user.email }
    });

    const response = NextResponse.json({
      success: true,
      redirectTo: '/admin/dashboard'
    });

    response.headers.set('Set-Cookie', serializedCookie);
    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
