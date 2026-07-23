import 'server-only';
import { supabaseAdmin } from './supabase-server';

export async function calculateCommission(
  bookingAmount: number,
  serviceCategoryId: string | null
): Promise<number> {
  let commissionPercent = 15.0; // Default fallback

  if (serviceCategoryId) {
    const { data: rule } = await supabaseAdmin
      .from('commission_rules')
      .select('commission_percent')
      .eq('service_category_id', serviceCategoryId)
      .eq('is_active', true)
      .single();

    if (rule && rule.commission_percent) {
      commissionPercent = Number(rule.commission_percent);
    }
  } else {
    // Check if there's a global default rule (null category)
    const { data: defaultRule } = await supabaseAdmin
      .from('commission_rules')
      .select('commission_percent')
      .is('service_category_id', null)
      .eq('is_active', true)
      .single();

    if (defaultRule && defaultRule.commission_percent) {
      commissionPercent = Number(defaultRule.commission_percent);
    }
  }

  const commissionAmount = (bookingAmount * commissionPercent) / 100;
  return Number(commissionAmount.toFixed(2));
}
