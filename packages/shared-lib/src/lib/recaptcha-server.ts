/**
 * Verifies a client-generated reCAPTCHA Enterprise token against Google Cloud assessments API.
 * 
 * @param token - Token generated on the client side
 * @param action - Action expected (e.g. 'LOGIN')
 * @returns Object indicating success, risk score, or failure reason
 */
export async function verifyRecaptchaToken(
  token: string | undefined, 
  action: string = 'LOGIN'
): Promise<{ success: boolean; score?: number; reason?: string }> {
  // Check if token is missing
  if (!token) {
    return { success: false, reason: 'Missing reCAPTCHA token' };
  }

  // Bypass logic: Only allowed if ALLOW_RECAPTCHA_BYPASS is 'true' AND NODE_ENV is not production AND token matches the bypass secret
  const isBypassAllowed = process.env.ALLOW_RECAPTCHA_BYPASS === 'true';
  const isNotProduction = process.env.NODE_ENV !== 'production';
  const isBypassToken = token === 'BYPASS_TOKEN_VOLO_DEV_SECRET';

  if (isBypassAllowed && isNotProduction && isBypassToken) {
    console.warn(`[reCAPTCHA Server] WARNING: reCAPTCHA verification bypassed using developer secret token.`);
    return { success: true, score: 1.0 };
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'volohome-16448';
  // Use server-only key for API request
  const apiKey = process.env.RECAPTCHA_SERVER_API_KEY;
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '6Ld_ASgtAAAAAP5S1xWBhboAdhtZs0XT5dGVshQA';

  if (!apiKey) {
    console.error('[reCAPTCHA Server] GCP Server API key (RECAPTCHA_SERVER_API_KEY) is not defined in environment variables.');
    return { success: false, reason: 'Server configuration error' };
  }

  try {
    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          token: token,
          siteKey: siteKey,
          expectedAction: action,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[reCAPTCHA Server] Google API error:', response.status, errorBody);
      return { success: false, reason: 'Verification service error' };
    }

    const data = await response.json();

    // Check if the assessment is valid
    if (!data.tokenProperties?.valid) {
      const invalidReason = data.tokenProperties?.invalidReason || 'Token validation failed';
      console.warn('[reCAPTCHA Server] Token is invalid:', invalidReason);
      return { success: false, reason: invalidReason };
    }

    // Verify expected action
    if (data.tokenProperties.action !== action) {
      console.warn(`[reCAPTCHA Server] Action mismatch: expected "${action}", got "${data.tokenProperties.action}"`);
      return { success: false, reason: 'Action mismatch' };
    }

    const score = data.riskAnalysis?.score ?? 0;
    console.log(`[reCAPTCHA Server] Assessment successful. Score: ${score}`);

    // Revised low-score risk threshold is 0.4
    const minRequiredScore = 0.4;
    if (score < minRequiredScore) {
      return { success: false, score, reason: 'Assessment risk check failed' };
    }

    return { success: true, score };
  } catch (err) {
    console.error('[reCAPTCHA Server] Exception during verification:', err);
    return { success: false, reason: 'Internal connection failure' };
  }
}
