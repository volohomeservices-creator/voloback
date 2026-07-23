import 'server-only';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { validateEnv } from './env';

// Ensure standard validation is triggered
validateEnv();

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

if (!getApps().length) {
  if (!projectId || !clientEmail || !privateKey) {
    const errorMsg = 'Firebase Admin initialization failed: FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY must be configured.';
    console.warn(`[Firebase Admin] ${errorMsg}`);
  } else {
    try {
      // Clean private key newlines and quote symbols from env values
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n').replace(/"/g, '').trim();
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: formattedPrivateKey,
        }),
      });
      console.log('[Firebase Admin] Initialization successful via service account certificate.');
    } catch (error) {
      console.error('[Firebase Admin] Fatal error initializing SDK:', error);
      throw error;
    }
  }
}

export const getAdminAuth = () => {
  if (!getApps().length) {
    throw new Error('Firebase Admin app is not initialized. Check FIREBASE_ADMIN_* env vars.');
  }
  return getAuth();
};

export const getAdminMessaging = () => {
  if (!getApps().length) {
    throw new Error('Firebase Admin app is not initialized. Check FIREBASE_ADMIN_* env vars.');
  }
  return getMessaging();
};

export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, prop) {
    const auth = getAdminAuth();
    const val = (auth as any)[prop];
    return typeof val === 'function' ? val.bind(auth) : val;
  }
});

export const adminMessaging = new Proxy({} as ReturnType<typeof getMessaging>, {
  get(_target, prop) {
    const messaging = getAdminMessaging();
    const val = (messaging as any)[prop];
    return typeof val === 'function' ? val.bind(messaging) : val;
  }
});

export async function verifyFirebaseToken(idToken: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      phone_number: decodedToken.phone_number || '',
    };
  } catch (error) {
    console.error('[Firebase Admin] Token verification failed:', error);
    throw new Error('FIREBASE_TOKEN_INVALID');
  }
}
