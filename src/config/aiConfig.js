/**
 * Centralized AI Configuration for SiteTactix
 */

export const AI_CONFIG = {
  primaryModel: (typeof process !== 'undefined' && process.env?.GEMINI_MODEL) || 'gemini-3.1-flash-lite',

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
