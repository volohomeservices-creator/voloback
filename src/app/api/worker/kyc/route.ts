import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { ensureBucketsExist } from '@/lib/storage-setup';

export async function GET(request: Request) {
  const cacheHeaders = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' };
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    // Run bucket initialization checks
    await ensureBucketsExist();

    // Fetch documents metadata
    const { data: documents, error: docsErr } = await supabaseAdmin
      .from('worker_documents')
      .select('*')
      .eq('worker_id', workerId);

    if (docsErr) throw docsErr;

    // Generate signed URLs for documents
    const docsWithUrls = await Promise.all((documents || []).map(async (doc) => {
      let bucket = 'kyc-docs';
      let path = '';

      if (doc.document_type === 'PROFILE_PHOTO') {
        bucket = 'profile-images';
        path = `worker_${workerId}/profile.webp`;
      } else {
        bucket = 'kyc-docs';
        const fileMap: Record<string, string> = {
          AADHAAR_FRONT: 'aadhaar-front.webp',
          AADHAAR_BACK: 'aadhaar-back.webp',
          PAN_CARD: 'pan.webp',
          SELFIE_VERIFICATION: 'selfie.webp'
        };
        path = `worker_${workerId}/${fileMap[doc.document_type]}`;
      }

      const { data } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, 3600); // 1 hour expiry

      return {
        ...doc,
        signedUrl: data?.signedUrl || null
      };
    }));

    // Fetch overall KYC status
    const { data: kycState, error: kycErr } = await supabaseAdmin
      .from('worker_kyc')
      .select('*')
      .eq('worker_id', workerId)
      .single();

    if (kycErr && kycErr.code !== 'PGRST116') throw kycErr;

    // Fetch user details for name
    const { data: userDetails } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', workerId)
      .single();

    // Fetch bank account details, dob, and worker_id_code from workers table
    const { data: workerData, error: workerErr } = await supabaseAdmin
      .from('workers')
      .select('bank_account_name, bank_account_number, bank_ifsc, dob, worker_id_code')
      .eq('id', workerId)
      .single();

    if (workerErr) throw workerErr;

    // Fetch skills from worker_profiles
    const { data: profile } = await supabaseAdmin
      .from('worker_profiles')
      .select('skills')
      .eq('worker_id', workerId)
      .maybeSingle();

    // Fetch active categories
    const { data: categories } = await supabaseAdmin
      .from('service_categories')
      .select('id, name')
      .eq('is_active', true);

    return NextResponse.json({
      success: true,
      documents: docsWithUrls,
      kycState: kycState || {
        worker_id: workerId,
        aadhaar_status: 'PENDING',
        pan_status: 'PENDING',
        selfie_status: 'PENDING',
        overall_status: 'PENDING',
        remarks: null,
        submitted_at: null
      },
      skills: profile?.skills || [],
      categories: categories || [],
      bankDetails: workerData ? {
        ...workerData,
        full_name: userDetails?.full_name || ''
      } : null
    }, { headers: cacheHeaders });
  } catch (error: any) {
    console.error('Error fetching KYC documents:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500, headers: cacheHeaders }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    const workerId = session.user_id;

    // Run bucket initialization checks
    await ensureBucketsExist();

    // Fetch overall kyc status
    const { data: kycState } = await supabaseAdmin
      .from('worker_kyc')
      .select('overall_status')
      .eq('worker_id', workerId)
      .single();

    if (kycState?.overall_status === 'APPROVED') {
      return NextResponse.json(
        { error: 'KYC application is already approved and locked.' },
        { status: 400 }
      );
    }

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { document_type, file_url, file_size, mime_type, bankDetails } = body;

    // 1. Handle Bank & Personal Details Upload if sent
    if (bankDetails) {
      const { bank_account_name, bank_account_number, bank_ifsc, full_name, dob, skills } = bankDetails;

      const updateData: any = {
        bank_account_name,
        bank_account_number,
        bank_ifsc
      };
      if (dob) {
        updateData.dob = dob;
      }

      // Generate worker_id_code if not already set
      const { data: currentWorker } = await supabaseAdmin
        .from('workers')
        .select('worker_id_code')
        .eq('id', workerId)
        .single();
      
      if (!currentWorker?.worker_id_code && full_name && dob) {
        let attempts = 0;
        let isUnique = false;
        const specialChars = ['@', '#', '$', '%', '&', '*', '!'];
        const digits = '0123456789';

        while (!isUnique && attempts < 100) {
          let firstName = 'VOLO';
          const parts = full_name.trim().split(/\s+/);
          if (parts[0]) {
            firstName = parts[0].toUpperCase().replace(/[^A-Z]/g, '');
          }
          firstName = (firstName + 'XXXX').slice(0, 4);

          let dobYear = '1995';
          const dobParts = dob.split('-');
          if (dobParts[0] && dobParts[0].length === 4) {
            dobYear = dobParts[0];
          }

          const char1 = specialChars[Math.floor(Math.random() * specialChars.length)];
          const char2 = digits[Math.floor(Math.random() * digits.length)];
          const candidateCode = `${firstName}${dobYear}${char1}${char2}`;

          const { data: existing } = await supabaseAdmin
            .from('workers')
            .select('id')
            .eq('worker_id_code', candidateCode)
            .maybeSingle();

          if (!existing) {
            updateData.worker_id_code = candidateCode;
            isUnique = true;
          }
          attempts++;
        }
      }

      const { error: updateBankErr } = await supabaseAdmin
        .from('workers')
        .update(updateData)
        .eq('id', workerId);

      if (updateBankErr) throw updateBankErr;

      // Update full_name in users table
      if (full_name) {
        const { error: updateUserErr } = await supabaseAdmin
          .from('users')
          .update({ full_name })
          .eq('id', workerId);
        if (updateUserErr) throw updateUserErr;
      }

      // Save/Update skills in worker_profiles
      if (Array.isArray(skills)) {
        const { data: existingProfile } = await supabaseAdmin
          .from('worker_profiles')
          .select('id')
          .eq('worker_id', workerId)
          .maybeSingle();

        if (existingProfile) {
          const { error: profileUpdateErr } = await supabaseAdmin
            .from('worker_profiles')
            .update({ skills, updated_at: new Date().toISOString() })
            .eq('worker_id', workerId);
          if (profileUpdateErr) throw profileUpdateErr;
        } else {
          const { error: profileInsertErr } = await supabaseAdmin
            .from('worker_profiles')
            .insert({
              worker_id: workerId,
              skills,
              city: 'Bangalore',
              state: 'Karnataka'
            });
          if (profileInsertErr) throw profileInsertErr;
        }

        // Explicitly trigger category sync function to verify consistency immediately
        try {
          await supabaseAdmin.rpc('sync_worker_categories_by_skills', { p_worker_id: workerId });
        } catch (err) {
          console.error('[KYC API] Failed to invoke sync_worker_categories_by_skills:', err);
        }
      }

      return NextResponse.json({ success: true, message: 'Bank and personal details updated.' });
    }

    // 2. Otherwise process Document Upload
    if (!document_type || !file_url || !file_size) {
      return NextResponse.json({ error: 'Missing document parameters' }, { status: 400 });
    }

    const validTypes = ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN_CARD', 'PROFILE_PHOTO', 'SELFIE_VERIFICATION'];
    if (!validTypes.includes(document_type)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    // Upsert into worker_documents
    const { error: docUpsertErr } = await supabaseAdmin
      .from('worker_documents')
      .upsert({
        worker_id: workerId,
        document_type,
        file_url,
        file_size,
        mime_type: mime_type || 'image/webp',
        status: 'PENDING',
        uploaded_at: new Date().toISOString()
      }, {
        onConflict: 'worker_id,document_type'
      });

    if (docUpsertErr) throw docUpsertErr;

    // Sync URLs to main workers table for compatibility
    let syncData: any = {};
    if (document_type === 'AADHAAR_FRONT') syncData.aadhar_front_url = file_url;
    if (document_type === 'AADHAAR_BACK') syncData.aadhar_back_url = file_url;
    if (document_type === 'PAN_CARD') syncData.pan_url = file_url;
    if (document_type === 'SELFIE_VERIFICATION') syncData.selfie_url = file_url;

    if (Object.keys(syncData).length > 0) {
      const { error: syncErr } = await supabaseAdmin
        .from('workers')
        .update(syncData)
        .eq('id', workerId);
      if (syncErr) throw syncErr;
    }

    // Update matching fields in worker_kyc status tracker
    let kycStatusUpdate: any = {};
    if (document_type === 'AADHAAR_FRONT' || document_type === 'AADHAAR_BACK') {
      // Aadhaar is approved when both front and back are approved
      kycStatusUpdate.aadhaar_status = 'PENDING';
    }
    if (document_type === 'PAN_CARD') {
      kycStatusUpdate.pan_status = 'PENDING';
    }
    if (document_type === 'SELFIE_VERIFICATION') {
      kycStatusUpdate.selfie_status = 'PENDING';
    }

    // Get all uploaded document types for this worker
    const { data: currentDocs } = await supabaseAdmin
      .from('worker_documents')
      .select('document_type')
      .eq('worker_id', workerId);

    const uploadedTypes = currentDocs?.map(d => d.document_type) || [];
    
    // Check if all 5 requirements are met
    const hasAllDocs = validTypes.every(type => uploadedTypes.includes(type) || type === document_type);

    if (hasAllDocs) {
      kycStatusUpdate.overall_status = 'PENDING';
      kycStatusUpdate.submitted_at = new Date().toISOString();
      // Reset remarks on resubmission
      kycStatusUpdate.remarks = null;
    }

    if (Object.keys(kycStatusUpdate).length > 0) {
      const { error: kycUpdateErr } = await supabaseAdmin
        .from('worker_kyc')
        .update(kycStatusUpdate)
        .eq('worker_id', workerId);

      if (kycUpdateErr) throw kycUpdateErr;
    }

    return NextResponse.json({
      success: true,
      message: 'Document uploaded successfully.',
      overallStatus: hasAllDocs ? 'PENDING' : 'INCOMPLETE'
    });
  } catch (error: any) {
    console.error('Error uploading KYC document:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    );
  }
}
