import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { AuditAction } from '@/types';

export async function logAuditAction({
  admin_id,
  action,
  target_type,
  target_id,
  metadata,
  ip_address,
}: {
  admin_id: string;
  action: AuditAction;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
}) {
  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      admin_id,
      action,
      target_type: target_type || null,
      target_id: target_id || null,
      metadata: metadata || null,
      ip_address: ip_address || null,
    });

    if (error) {
      console.error('Failed to write audit log:', error);
    }
  } catch (error) {
    console.error('Exception writing audit log:', error);
  }
}
