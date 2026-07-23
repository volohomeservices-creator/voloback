import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

if (!supabaseServiceKey) {
  console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is missing from environment.');
}

// Avoid instantiating multiple clients in development (HMR)
const globalForSupabase = globalThis as unknown as {
  supabaseAdmin: any | undefined;
};

export const supabaseAdmin: any =
  globalForSupabase.supabaseAdmin ??
  createClient(supabaseUrl, supabaseServiceKey || 'placeholder-service-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabaseAdmin = supabaseAdmin;
}
