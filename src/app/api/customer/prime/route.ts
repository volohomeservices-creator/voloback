import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const { data: { action }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse; // 'SUBSCRIBE' or 'UNSUBSCRIBE'

    if (action !== 'SUBSCRIBE' && action !== 'UNSUBSCRIBE') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const isPrime = action === 'SUBSCRIBE';

    const { error } = await supabaseAdmin
      .from('users')
      .update({ is_prime: isPrime })
      .eq('id', session.user_id);

    if (error) throw error;

    return NextResponse.json({ success: true, is_prime: isPrime });
  } catch (error: any) {
    console.error('Error updating prime status:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
