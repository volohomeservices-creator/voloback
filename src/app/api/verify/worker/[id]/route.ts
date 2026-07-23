import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Search by either worker_id_code or UUID
    const { data: worker, error: workerErr } = await supabaseAdmin
      .from('workers')
      .select('*, users(*), worker_profiles(*)')
      .or(`worker_id_code.eq.${id},id.eq.${id}`)
      .single();

    if (workerErr || !worker) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
    }

    // Resolve service category names
    let categoryNames: string[] = [];
    if (worker.service_category_ids && worker.service_category_ids.length > 0) {
      const { data: categories } = await supabaseAdmin
        .from('service_categories')
        .select('name')
        .in('id', worker.service_category_ids);
      if (categories) {
        categoryNames = categories.map((c: any) => c.name);
      }
    }

    // Generate a secure signed URL for the profile photo
    const { data: signData } = await supabaseAdmin.storage
      .from('profile-images')
      .createSignedUrl(`worker_${worker.id}/profile.webp`, 3600); // 1 hr expiry

    let photoUrl = signData?.signedUrl || null;
    if (!photoUrl) {
      const { data: selfieData } = await supabaseAdmin.storage
        .from('kyc-docs')
        .createSignedUrl(`worker_${worker.id}/selfie.webp`, 3600);
      photoUrl = selfieData?.signedUrl || null;
    }

    // Mask phone number for privacy
    const maskPhone = (phone: string | null) => {
      if (!phone) return 'N/A';
      // Typical format: +919133632095 or 9133632095
      if (phone.length <= 4) return '******';
      return `${phone.slice(0, 5)}*****${phone.slice(-3)}`;
    };

    return NextResponse.json({
      success: true,
      worker: {
        id: worker.id,
        full_name: worker.users?.full_name || 'Service Professional',
        phone: maskPhone(worker.users?.phone),
        rating: worker.rating || 5.0,
        total_jobs: worker.total_jobs || 0,
        worker_id_code: worker.worker_id_code || worker.id.slice(0, 8),
        skills: worker.worker_profiles?.skills || [],
        service_categories: categoryNames,
        photoUrl: photoUrl,
        created_at: worker.created_at,
        kyc_status: worker.kyc_status
      }
    });
  } catch (error: any) {
    console.error('Error fetching public worker verification data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
