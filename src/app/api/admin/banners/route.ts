import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');

    const { data: banners, error } = await supabaseAdmin
      .from('mobile_banners')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ banners: banners || [] });
  } catch (error: any) {
    console.error('Error fetching admin mobile banners:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { title, subtitle, discount_label, action_url, background_color, image_name, active } = body;

    if (!title || !subtitle) {
      return NextResponse.json({ error: 'Title and subtitle are required.' }, { status: 400 });
    }

    const { data: newBanner, error } = await supabaseAdmin
      .from('mobile_banners')
      .insert({
        title,
        subtitle,
        discount_label: discount_label || 'OFFER',
        action_url: action_url || null,
        background_color: background_color || '#6366f1',
        image_name: image_name || 'home_services_banner.png',
        active: active !== undefined ? active : true
      })
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, banner: newBanner });
  } catch (error: any) {
    console.error('Error creating mobile banner:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
