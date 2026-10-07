/**
 * How fresh the Google (Drive/Sheets) sign-in is, for the dot in the top bar.
 * Google access tokens last about an hour; the app renews them a little before that.
 */

export const GOOGLE_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
export const GOOGLE_TOKEN_RENEW_AFTER_MS = 50 * 60 * 1000;

/**
 * Age of the saved token in milliseconds, or null when there is no token.
 * A token saved without a time (older app versions) counts as too old.
 */
export function getGoogleTokenAgeMs({ token, issuedAt, now = Date.now() }) {
  if (!token) return null;
  const issued = parseInt(issuedAt || '0', 10);
  if (!issued) return Infinity;
  return Math.max(0, now - issued);
}

/** True when the next tap should renew the pass (from 50 minutes on, or when there is none). */
export function shouldRenewGoogleToken(ageMs) {
  return ageMs === null || ageMs >= GOOGLE_TOKEN_RENEW_AFTER_MS;
}

/**
 * 'connected'    - green dot: the hour-long Google pass is still valid.
 * 'needs_signin' - amber dot: the pass has run out; tap to reconnect.
 * 'none'         - no dot: never connected to Google on this device.
 */
export function getGoogleConnectionStatus({ ageMs, hasGoogleUser }) {
  if (ageMs === null) return hasGoogleUser ? 'needs_signin' : 'none';
  if (ageMs >= GOOGLE_TOKEN_LIFETIME_MS) return 'needs_signin';
  return 'connected';
}
