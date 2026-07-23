import 'server-only';

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_ADMIN_PROJECT_ID',
  'FIREBASE_ADMIN_CLIENT_EMAIL',
  'FIREBASE_ADMIN_PRIVATE_KEY',
  'SESSION_SECRET',
  'CRON_SECRET',
  'GOOGLE_MAPS_API_KEY'
];

const PLACEHOLDERS = [
  'placeholder',
  'placeholder_session_secret_min_32_chars_long',
  'placeholder_key',
  'placeholder_secret',
  'placeholder-service-key'
];

let validated = false;

export function validateEnv() {
  if (validated) return;

  const missing: string[] = [];
  const invalid: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  for (const key of REQUIRED_ENV_VARS) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      missing.push(key);
    } else if (PLACEHOLDERS.some(p => val.toLowerCase().includes(p.toLowerCase()))) {
      invalid.push(`${key} (contains placeholder value)`);
    }
  }

  // Enforce session secret minimum 32-character cryptographic size
  if (process.env.SESSION_SECRET) {
    const sec = process.env.SESSION_SECRET.trim();
    if (sec.length < 32 || PLACEHOLDERS.some(p => sec.includes(p))) {
      invalid.push('SESSION_SECRET (must be at least 32 characters long and not a placeholder)');
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    const errorLines = [
      '[Env Validator] WARNING: Missing or invalid environment configuration:',
      ...missing.map(k => `  - MISSING: ${k}`),
      ...invalid.map(k => `  - INVALID: ${k}`)
    ];
    
    const message = errorLines.join('\n');
    console.warn(`\n${message}\n`);
  } else {
    console.log('[Env Validator] All required environment variables successfully validated.');
    validated = true;
  }
}

// Automatically trigger validation when env module is imported in server context
validateEnv();
