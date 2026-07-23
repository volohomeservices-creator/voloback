import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const { data: { fullName, email }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!fullName) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .update({
        full_name: fullName,
        email: email || null
      })
      .eq('id', session.user_id)
      .select('id, role, full_name, phone, email')
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'Failed to update user details' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user
    });
  } catch (error: any) {
    if (error.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
