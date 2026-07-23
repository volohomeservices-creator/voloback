import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'customer');

    // Fetch favorites with worker details
    const { data: favorites, error } = await supabaseAdmin
      .from('customer_favorites')
      .select(`
        id,
        created_at,
        worker_id,
        workers (
          id,
          users (
            full_name,
            avatar_url
          )
        )
      `)
      .eq('customer_id', session.user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[/api/customer/favorites] Supabase Error:', error);
      throw error;
    }

    return NextResponse.json({ favorites: favorites || [] });
  } catch (error: any) {
    console.error('Error fetching favorites:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'customer');
    const { data: { worker_id, action }, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse; // action: 'ADD' | 'REMOVE'

    if (!worker_id || !action) {
      return NextResponse.json({ error: 'Worker ID and action required' }, { status: 400 });
    }

    if (action === 'ADD') {
      const { data, error } = await supabaseAdmin
        .from('customer_favorites')
        .insert({
          customer_id: session.user_id,
          worker_id
        });
      // Ignore unique constraint error if already favorited
      if (error && error.code !== '23505') throw error;
      
    } else if (action === 'REMOVE') {
      const { error } = await supabaseAdmin
        .from('customer_favorites')
        .delete()
        .eq('customer_id', session.user_id)
        .eq('worker_id', worker_id);
      
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error modifying favorites:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
