import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireSession(request);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, role, full_name, phone, email, is_active, is_prime, volo_coins')
      .eq('id', session.user_id)
      .single();

    if (error || !user) {
      console.error('[/api/auth/me] Supabase Error fetching user:', error, 'User ID:', session.user_id);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404, headers: cacheHeaders });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'ACCOUNT_BLOCKED' }, { status: 403, headers: cacheHeaders });
    }

    return NextResponse.json({
      success: true,
      user
    }, { headers: cacheHeaders });
  } catch (error: any) {
    if (error.status === 401) {
      return NextResponse.json({ error: 'Session expired or invalid. Please login again.' }, { status: 401, headers: cacheHeaders });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: cacheHeaders });
  }
}

