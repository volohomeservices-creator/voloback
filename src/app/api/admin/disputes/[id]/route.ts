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
    const session = await requireRole(request, 'admin');
    const { id } = await params;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { action, resolutionNotes } = body;

    let updateData: any = {};
    if (action === 'ASSIGN') {
      updateData.assigned_admin_id = session.user_id;
      updateData.status = 'IN_PROGRESS';
    } else if (action === 'RESOLVE') {
      updateData.status = 'RESOLVED';
      updateData.resolved_at = new Date().toISOString();
      if (resolutionNotes) {
        updateData.resolution_notes = resolutionNotes;
      }
    } else {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('disputes')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: `Dispute ${action}D successfully.` });
  } catch (error: any) {
    console.error('Error updating dispute:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
