import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(request, 'admin');
    const { id } = await props.params;
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { title, subtitle, discount_label, action_url, background_color, image_name, active } = body;

    const { data: updatedBanner, error } = await supabaseAdmin
      .from('mobile_banners')
      .update({
        title,
        subtitle,
        discount_label,
        action_url,
        background_color,
        image_name,
        active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, banner: updatedBanner });
  } catch (error: any) {
    console.error('Error updating mobile banner:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(request, 'admin');
    const { id } = await props.params;

    const { error } = await supabaseAdmin
      .from('mobile_banners')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Banner deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting mobile banner:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
