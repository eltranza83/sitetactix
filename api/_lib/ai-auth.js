import { HttpError } from './firebase-auth.js';

/**
 * Resolve the Gemini API key strictly for server-side usage.
 * In production, strictly enforces process.env.GEMINI_API_KEY.
 * In development, also accepts VITE_GEMINI_API_KEY from the local .env file. Keys sent by a browser are never used.
 */
export function resolveServerGeminiKey() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.GEMINI_API_KEY || '';
  }
  return process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
}

/**
 * Map upstream AI provider errors cleanly based strictly on status code,
 * omitting any raw provider response body or internal details.
 */
export function sanitizeUpstreamAiError(status) {
  if (status === 429) {
    return new HttpError(429, 'AI service is temporarily experiencing high traffic. Please retry in a few moments.');
  }
  if (status === 504 || status === 'TIMEOUT') {
    return new HttpError(504, 'AI request timed out while contacting upstream service. Please retry.');
  }
  return new HttpError(502, 'AI service is temporarily unavailable. Please retry in a moment.');
}
