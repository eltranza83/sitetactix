/**
 * Centralized Server-Side AI Configuration for Vercel API Routes
 */

export const AI_CONFIG = {
  primaryModel: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',

  retry: {
    maxRetries: 2,
    initialDelayMs: 400,
    backoffFactor: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  },

  generation: {
    temperature: 0.3,
    maxOutputTokens: 2048
  }
};
