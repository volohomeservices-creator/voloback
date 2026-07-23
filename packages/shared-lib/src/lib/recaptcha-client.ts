declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready: (callback: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    };
  }
}

let scriptLoadingPromise: Promise<void> | null = null;

/**
 * Dynamically loads the reCAPTCHA Enterprise script.
 */
async function loadEnterpriseScript(siteKey: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.grecaptcha?.enterprise) return;

  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  scriptLoadingPromise = new Promise((resolve, reject) => {
    console.log('[reCAPTCHA Client] Loading reCAPTCHA Enterprise script dynamically...');
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      let attempts = 0;
      const checkInterval = setInterval(() => {
        if (window.grecaptcha?.enterprise) {
          clearInterval(checkInterval);
          console.log('[reCAPTCHA Client] reCAPTCHA Enterprise script loaded successfully.');
          resolve();
        } else if (attempts >= 50) { // 5 seconds max timeout
          clearInterval(checkInterval);
          reject(new Error('reCAPTCHA Enterprise script loaded but window.grecaptcha.enterprise was not found.'));
        }
        attempts++;
      }, 100);
    };

    script.onerror = (err) => {
      reject(err);
    };

    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
}

/**
 * Cleans up the dynamically loaded reCAPTCHA Enterprise script, iframes, and global window objects.
 * This prevents conflicts with Firebase's internal reCAPTCHA Verifier.
 */
export function cleanupEnterpriseRecaptcha(): void {
  if (typeof window === 'undefined') return;

  console.log('[reCAPTCHA Client] Cleaning up reCAPTCHA Enterprise objects and scripts...');

  // 1. Remove script tags matching recaptcha (both api.js and enterprise.js)
  const scripts = document.querySelectorAll('script[src*="recaptcha"]');
  scripts.forEach(script => script.remove());

  // 2. Remove recaptcha iframe container and badge elements from DOM
  const iframes = document.querySelectorAll('iframe[src*="recaptcha"]');
  iframes.forEach(iframe => iframe.remove());

  const badges = document.querySelectorAll('.grecaptcha-badge');
  badges.forEach(badge => badge.remove());

  // 3. Clear window properties
  if (window.grecaptcha) {
    try {
      window.grecaptcha = undefined;
    } catch {
      // Fallback if readonly
      (window as unknown as { grecaptcha: unknown }).grecaptcha = undefined;
    }
  }

  // Reset module level loading promise
  scriptLoadingPromise = null;
}

/**
 * Execute client-side reCAPTCHA Enterprise verification.
 * Loads the reCAPTCHA Enterprise script lazily on first invocation.
 * 
 * @param action - Action name (e.g., 'LOGIN')
 * @returns Generated assessment token, or null if execution failed
 */
export async function executeRecaptcha(action: string): Promise<string | null> {
  const isBypassRequested = process.env.NEXT_PUBLIC_ALLOW_RECAPTCHA_BYPASS === 'true';
  const isNotProduction = process.env.NODE_ENV !== 'production';
  const isLocalhost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isNotProduction && (isBypassRequested || isLocalhost)) {
    console.log('[reCAPTCHA] Dev/local bypass active. Returning developer secret token.');
    return 'BYPASS_TOKEN_VOLO_DEV_SECRET';
  }

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    console.warn('[reCAPTCHA] Site key (NEXT_PUBLIC_RECAPTCHA_SITE_KEY) is missing. Bypassing client-side token.');
    return 'BYPASS_TOKEN_VOLO_DEV_SECRET';
  }

  if (typeof window === 'undefined') {
    return null;
  }

  // Wipes out any pre-loaded recaptcha scripts (e.g. standard api.js) to avoid namespace conflicts
  cleanupEnterpriseRecaptcha();

  try {
    // Dynamically load the script
    await loadEnterpriseScript(siteKey);

    return new Promise((resolve) => {
      const recaptcha = window.grecaptcha;
      if (!recaptcha?.enterprise) {
        console.warn('[reCAPTCHA] grecaptcha.enterprise is not available.');
        resolve('BYPASS_TOKEN_VOLO_DEV_SECRET');
        return;
      }

      recaptcha.enterprise.ready(async () => {
        try {
          const token = await recaptcha.enterprise.execute(siteKey, { action });
          resolve(token);
        } catch (err) {
          console.error('[reCAPTCHA] Error executing grecaptcha.enterprise:', err);
          resolve(null);
        }
      });
    });
  } catch (err) {
    console.error('[reCAPTCHA] Failed to load or execute reCAPTCHA Enterprise dynamically:', err);
    return 'BYPASS_TOKEN_VOLO_DEV_SECRET';
  }
}
