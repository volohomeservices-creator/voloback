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

export const adminAuth = getAuth();
export const adminMessaging = getMessaging();

export async function verifyFirebaseToken(idToken: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      phone_number: decodedToken.phone_number || '',
    };
  } catch (error) {
    throw new Error('FIREBASE_TOKEN_INVALID');
  }
}
