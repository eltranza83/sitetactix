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
 * Read and validate an incoming JSON request body with byte size and structure checks.
 */
export async function readAndValidateJsonBody(request, { maxBytes = 100 * 1024 } = {}) {
  // 1. Early Content-Length header inspection
  const contentLength = parseInt(request.headers?.get('content-length') || '0', 10);
  if (contentLength > maxBytes) {
    throw new HttpError(413, `Request payload exceeds maximum allowed size of ${Math.round(maxBytes / 1024)} KB.`);
  }

  // 2. Read raw text with explicit stream error handling
  let rawText;
  try {
    rawText = await request.text();
  } catch {
    throw new HttpError(400, 'Failed to read request body.');
  }

  // 3. Exact UTF-8 byte verification on received body
  const actualBytes = new TextEncoder().encode(rawText || '').length;
  if (actualBytes > maxBytes) {
    throw new HttpError(413, `Request payload exceeds maximum allowed size of ${Math.round(maxBytes / 1024)} KB.`);
  }

  // 4. JSON parse
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  return body;
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
