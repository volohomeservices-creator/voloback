import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1, 'Missing NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Missing SUPABASE_SERVICE_ROLE_KEY'),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1, 'Missing NEXT_PUBLIC_FIREBASE_API_KEY'),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1, 'Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: z.string().min(1, 'Missing NEXT_PUBLIC_GOOGLE_MAPS_KEY'),
});

// Since Next.js bundles code for client and server differently, and we are validating 
// server-side environments on boot, we'll try parsing process.env.
// In Next.js, process.env is injected at build time for NEXT_PUBLIC vars, but 
// server-only vars are available at runtime.
const parsedEnv = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_GOOGLE_MAPS_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY,
});

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  
  // Do not crash during Next.js build step (when some env vars might be missing),
  // but crash during runtime/start
  if (process.env.NODE_ENV !== 'test' && !process.env.CI && !process.env.NEXT_PHASE) {
    throw new Error('Invalid environment variables');
  }
}

export const env = parsedEnv.success ? parsedEnv.data : process.env;
