import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

// GET: List all promo codes
export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');

    const { data, error } = await supabaseAdmin
      .from('promo_codes')
      .select('*, created_by_user:users(full_name)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ promo_codes: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// POST: Create a new promo code
export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    const {
      code,
      description,
      discount_type,
      discount_value,
      min_order_amount,
      max_discount_amount,
      max_uses,
      applicable_role,
      valid_from,
      expires_at,
    } = body;

    if (!code || !discount_type || !discount_value) {
      return NextResponse.json({ error: 'code, discount_type, discount_value are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('promo_codes')
      .insert({
        code: code.trim().toUpperCase(),
        description,
        discount_type,
        discount_value: Number(discount_value),
        min_order_amount: Number(min_order_amount || 0),
        max_discount_amount: max_discount_amount ? Number(max_discount_amount) : null,
        max_uses: max_uses ? Number(max_uses) : null,
        applicable_role: applicable_role || 'customer',
        valid_from: valid_from || new Date().toISOString(),
        expires_at: expires_at || null,
        active: true,
        created_by: session.user_id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A promo code with this name already exists' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ promo_code: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// PATCH: Toggle active/inactive or update a promo code
export async function PATCH(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { id, active } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('promo_codes')
      .update({ active: Boolean(active) })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ promo_code: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}

// DELETE: Deactivate (soft delete) a promo code
export async function DELETE(request: Request) {
  try {
    await requireRole(request, 'admin');
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('promo_codes')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
