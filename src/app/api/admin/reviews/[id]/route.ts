import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(request, 'admin');
    const { id } = await params;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { action } = body;

    let updateData: any = {};
    if (action === 'HIDE') {
      updateData.is_hidden = true;
    } else if (action === 'UNHIDE') {
      updateData.is_hidden = false;
    } else {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('reviews')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: `Review ${action}D successfully.` });
  } catch (error: any) {
    console.error('Error updating review:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
