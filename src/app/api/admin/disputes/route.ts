import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;

export async function GET(request: Request) {
  try {
    await requireRole(request, 'admin');
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '15');
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('disputes')
      .select(`
        id,
        booking_id,
        type,
        description,
        status,
        resolution_notes,
        created_at,
        resolved_at,
        reporter:reported_by_id(full_name, phone, role),
        admin:assigned_admin_id(full_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (search) {
      // Basic search on booking_id if it's a valid uuid, otherwise ignore
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      if (isUUID) {
        query = query.eq('booking_id', search);
      }
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      disputes: data,
      total: count || 0,
      page,
      limit
    });
  } catch (error: any) {
    console.error('Error fetching disputes:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
