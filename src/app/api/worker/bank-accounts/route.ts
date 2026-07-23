import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';
import { dispatchNotification } from '@/lib/notification-dispatcher';
import { encryptBankAccount, decryptBankAccount } from '@/lib/settlement-engine';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from('worker_bank_accounts')
      .select('*')
      .eq('worker_id', session.user_id)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned

    if (!data) return NextResponse.json({ account: null });

    // Decrypt the full account number so they can see it (or you might only want to show last 4 on frontend)
    let decrypted = '';
    try {
      decrypted = decryptBankAccount(data.account_number_encrypted);
    } catch (e) {
      decrypted = '';
    }

    return NextResponse.json({
      account: {
        ...data,
        account_number_decrypted: decrypted
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'worker');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { account_holder_name, bank_name, account_number, ifsc_code } = body;

    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    const encrypted = encryptBankAccount(account_number);
    const lastFour = account_number.slice(-4);

    const { data: existing } = await supabaseAdmin
      .from('worker_bank_accounts')
      .select('id')
      .eq('worker_id', session.user_id)
      .single();

    const isUpdate = !!existing;

    const payload = {
      worker_id: session.user_id,
      account_holder_name,
      bank_name,
      account_number_encrypted: encrypted,
      account_last_four: lastFour,
      ifsc_code,
      is_verified: false, // reset verification on update
      updated_at: new Date().toISOString()
    };

    let result;
    if (isUpdate) {
      result = await supabaseAdmin
        .from('worker_bank_accounts')
        .update(payload)
        .eq('worker_id', session.user_id)
        .select()
        .single();
    } else {
      result = await supabaseAdmin
        .from('worker_bank_accounts')
        .insert(payload)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    await logAuditAction({
      admin_id: session.user_id, // technically worker_id but we use admin_id for the actor
      action: isUpdate ? AuditAction.BANK_ACCOUNT_UPDATED : AuditAction.BANK_ACCOUNT_ADDED,
      target_type: 'worker_bank_accounts',
      target_id: result.data.id,
      metadata: { is_verified: false }
    });

    // Notify admins
    const { data: admins } = await supabaseAdmin.from('users').select('id').eq('role', 'admin');
    if (admins) {
      for (const admin of admins) {
        await dispatchNotification({
          userId: admin.id,
          type: 'MANUAL_ASSIGNMENT_CREATED' as any, // Reusing enum or custom
          title: 'Bank Verification Pending',
          body: `A worker has updated their bank details and requires verification.`,
        });
      }
    }

    return NextResponse.json({ success: true, account: result.data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
