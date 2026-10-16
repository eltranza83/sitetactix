/**
 * Centralized Server-Side AI Configuration for Vercel API Routes
 */

export const AI_CONFIG = {
  primaryModel: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  // Used for a scan only when Google says the main model is busy, out of quota or failing
  backupModel: process.env.GEMINI_BACKUP_MODEL || 'gemini-3.5-flash-lite',

  retry: {
    maxRetries: 2,
    initialDelayMs: 400,
    backoffFactor: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  }
};
