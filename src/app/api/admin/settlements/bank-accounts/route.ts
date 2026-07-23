import { z } from 'zod';
import { validateBody } from '@/lib/zod-validator';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin as supabaseAdminOriginal } from '@/lib/supabase-server';
const supabaseAdmin: any = supabaseAdminOriginal;
import { logAuditAction } from '@/lib/audit';
import { AuditAction } from '@/types';
import { dispatchNotification } from '@/lib/notification-dispatcher';
import { decryptBankAccount } from '@/lib/settlement-engine';

export async function GET(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from('worker_bank_accounts')
      .select('*, workers(users(full_name, phone))')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Decrypt the account numbers before sending to admin for verification
    const decryptedData = data.map(account => {
      let decryptedAccount = '';
      try {
        decryptedAccount = decryptBankAccount(account.account_number_encrypted);
      } catch (e) {
        decryptedAccount = 'Error Decrypting';
      }
      return {
        ...account,
        account_number_decrypted: decryptedAccount
      };
    });

    return NextResponse.json({ accounts: decryptedData });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, 'admin');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: body, errorResponse } = await validateBody(request, z.any());
    if (errorResponse) return errorResponse;
    const { accountId, action } = body;

    if (!accountId || !action) {
      return NextResponse.json({ error: 'Missing accountId or action' }, { status: 400 });
    }

    const isVerified = action === 'VERIFY';

    const { data: account, error: updateErr } = await supabaseAdmin
      .from('worker_bank_accounts')
      .update({ is_verified: isVerified, updated_at: new Date().toISOString() })
      .eq('id', accountId)
      .select('worker_id')
      .single();

    if (updateErr || !account) throw updateErr;

    await logAuditAction({
      admin_id: session.user_id,
      action: AuditAction.BANK_ACCOUNT_VERIFIED,
      target_type: 'worker_bank_accounts',
      target_id: accountId,
      metadata: { is_verified: isVerified }
    });

    await dispatchNotification({
      userId: account.worker_id,
      type: 'KYC_APPROVED' as any, // Reusing enum for now
      title: isVerified ? 'Bank Account Verified' : 'Bank Account Rejected',
      body: isVerified ? 'Your bank account has been verified for payouts.' : 'There was an issue verifying your bank account. Please update your details.',
    });

    return NextResponse.json({ success: true, is_verified: isVerified });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
