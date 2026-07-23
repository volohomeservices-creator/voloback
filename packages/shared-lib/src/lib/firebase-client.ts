import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  Auth,
  initializeRecaptchaConfig,
} from 'firebase/auth';

// ---------------------------------------------------------------------------
// 1. Firebase App + Auth initialization
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const firebaseAuth = getAuth(firebaseApp);

// ---------------------------------------------------------------------------
// 2. Initialize reCAPTCHA Enterprise config
//    Your Firebase Console has reCAPTCHA Enterprise in AUDIT mode with a
//    web site key "volohome-phone-auth". This call tells the SDK to fetch
//    that Enterprise config from the server so RecaptchaVerifier generates
//    Enterprise tokens instead of standard ones.
// ---------------------------------------------------------------------------
let recaptchaConfigReady: Promise<void> | null = null;

if (typeof window !== 'undefined') {
  recaptchaConfigReady = initializeRecaptchaConfig(firebaseAuth)
    .then(() => {
      console.log('[Firebase] reCAPTCHA Enterprise config loaded successfully');
    })
    .catch((err) => {
      console.warn('[Firebase] reCAPTCHA Enterprise config failed:', err);
    });
}

console.log('[Firebase] Initialized:', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
});

export { firebaseApp, firebaseAuth };

// ---------------------------------------------------------------------------
// 3. RecaptchaManager — MINIMAL wrapper
//    CRITICAL: Do NOT purge window.grecaptcha, scripts, or iframes.
//    Firebase manages its own reCAPTCHA Enterprise lifecycle internally.
//    Destroying those objects was the root cause of auth/invalid-app-credential.
// ---------------------------------------------------------------------------
class RecaptchaManager {
  private static instance: RecaptchaVerifier | null = null;
  private static containerId = 'firebase-recaptcha-container';
  private static isSending = false;

  static async getOrCreate(auth: Auth): Promise<RecaptchaVerifier> {
    if (typeof window === 'undefined') {
      throw new Error('Client only');
    }

    // Wait for Enterprise config to be loaded before creating verifier
    if (recaptchaConfigReady) {
      await recaptchaConfigReady;
    }

    // If we already have a valid instance, return it
    if (this.instance) {
      return this.instance;
    }

    // Ensure a fresh container exists
    let container = document.getElementById(this.containerId);
    if (container) {
      container.remove();
    }
    container = document.createElement('div');
    container.id = this.containerId;
    document.body.appendChild(container);

    console.log('[Phone Auth] Creating RecaptchaVerifier (Enterprise mode)');
    this.instance = new RecaptchaVerifier(auth, container, {
      size: 'invisible',
      callback: () => {
        console.log('[Phone Auth] reCAPTCHA solved');
      },
      'expired-callback': () => {
        console.log('[Phone Auth] reCAPTCHA expired');
        this.reset();
      },
    });

    return this.instance;
  }

  static reset(): void {
    if (this.instance) {
      try {
        this.instance.clear();
      } catch (_) {
        // ignore
      }
      this.instance = null;
    }
    const container = document.getElementById(this.containerId);
    if (container) container.remove();
    console.log('[Phone Auth] RecaptchaVerifier reset');
  }

  static get sending() { return this.isSending; }
  static set sending(v: boolean) { this.isSending = v; }
}

// ---------------------------------------------------------------------------
// 4. Phone OTP API
// ---------------------------------------------------------------------------

export async function initializePhoneAuth(): Promise<void> {
  // Ensure Enterprise config is loaded
  if (recaptchaConfigReady) {
    await recaptchaConfigReady;
  }
}

export async function cleanupPhoneAuth(): Promise<void> {
  RecaptchaManager.reset();
}

export async function sendOtp(phone: string): Promise<ConfirmationResult> {
  if (typeof window === 'undefined') {
    throw new Error('Client only');
  }
  if (RecaptchaManager.sending) {
    throw new Error('OTP_IN_PROGRESS');
  }

  RecaptchaManager.sending = true;
  console.log('[Phone Auth] Sending OTP to:', phone);

  try {
    const verifier = await RecaptchaManager.getOrCreate(firebaseAuth);
    const confirmationResult = await signInWithPhoneNumber(firebaseAuth, phone, verifier);
    console.log('[Phone Auth] OTP sent successfully');
    return confirmationResult;
  } catch (error: any) {
    console.error('[Phone Auth] OTP Error during send:', error?.code, error?.message);
    RecaptchaManager.reset();
    throw error;
  } finally {
    RecaptchaManager.sending = false;
  }
}

export async function verifyOtp(
  confirmationResult: ConfirmationResult,
  otp: string
): Promise<string> {
  if (!confirmationResult || typeof confirmationResult.confirm !== 'function') {
    throw new Error('Invalid ConfirmationResult. Request a new OTP.');
  }

  console.log('[Phone Auth] Verifying OTP...');
  const result = await confirmationResult.confirm(otp);
  if (!result.user) throw new Error('OTP verification failed');

  console.log('[Phone Auth] OTP Verified');
  RecaptchaManager.reset();
  return result.user.getIdToken();
}

// ---------------------------------------------------------------------------
// 5. Legacy exports
// ---------------------------------------------------------------------------
export function getOrCreateRecaptchaVerifier(): RecaptchaVerifier {
  // This is now async internally, but kept for backward compat
  return RecaptchaManager.getOrCreate(firebaseAuth) as any;
}

export function cleanupRecaptchaVerifier(): void {
  RecaptchaManager.reset();
}
