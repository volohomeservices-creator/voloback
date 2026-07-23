import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const { data: { code, order_amount }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;

    if (!code) {
      return NextResponse.json({ error: 'Promo code is required' }, { status: 400 });
    }

    // 1. Find the promo code
    const { data: promo, error: fetchErr } = await supabaseAdmin
      .from('promo_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .eq('active', true)
      .single();

    if (fetchErr || !promo) {
      return NextResponse.json({ error: 'Invalid or expired promo code', valid: false }, { status: 404 });
    }

    // 2. Check expiry
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This promo code has expired', valid: false }, { status: 400 });
    }

    // 3. Check valid_from
    if (promo.valid_from && new Date(promo.valid_from) > new Date()) {
      return NextResponse.json({ error: 'This promo code is not active yet', valid: false }, { status: 400 });
    }

    // 4. Check max_uses
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
      return NextResponse.json({ error: 'This promo code has reached its usage limit', valid: false }, { status: 400 });
    }

    // 5. Check applicable role
    if (promo.applicable_role !== 'all' && promo.applicable_role !== session.role) {
      return NextResponse.json({ error: 'This promo code is not applicable for your account type', valid: false }, { status: 400 });
    }

    // 6. Check if user already used this code
    const { data: existingUsage } = await supabaseAdmin
      .from('promo_code_usages')
      .select('id')
      .eq('promo_code_id', promo.id)
      .eq('user_id', session.user_id)
      .single();

    if (existingUsage) {
      return NextResponse.json({ error: 'You have already used this promo code', valid: false }, { status: 400 });
    }

    // 7. Check min order amount
    const orderAmt = Number(order_amount || 0);
    if (promo.min_order_amount && orderAmt < Number(promo.min_order_amount)) {
      return NextResponse.json({
        error: `Minimum order amount of ₹${promo.min_order_amount} required for this code`,
        valid: false,
      }, { status: 400 });
    }

    // 8. Calculate discount
    let discountAmount = 0;
    if (promo.discount_type === 'FLAT') {
      discountAmount = Math.min(Number(promo.discount_value), orderAmt);
    } else {
      // PERCENT
      discountAmount = (orderAmt * Number(promo.discount_value)) / 100;
      if (promo.max_discount_amount) {
        discountAmount = Math.min(discountAmount, Number(promo.max_discount_amount));
      }
    }

    return NextResponse.json({
      valid: true,
      promo_code_id: promo.id,
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      discount_amount: Math.round(discountAmount * 100) / 100,
      description: promo.description,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500 });
  }
}
