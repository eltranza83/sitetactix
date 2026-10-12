import { HttpError } from './firebase-auth.js';

/**
 * Helper to perform fetch requests with exponential backoff and jitter.
 * Replaces hardcoded multi-model trial failover loops with reliable retries on the configured model.
 */
export async function fetchWithExponentialBackoff(
  url,
  options = {},
  retryConfig = { maxRetries: 3, initialDelayMs: 500, backoffFactor: 2, jitter: true, retryableStatusCodes: [429, 500, 502, 503, 504] },
  fetchImpl = fetch
) {
  const { maxRetries = 3, initialDelayMs = 500, backoffFactor = 2, jitter = true, retryableStatusCodes = [429, 500, 502, 503, 504] } = retryConfig;
  const timeoutMs = options.timeoutMs || 25000;
  // Total time allowed across all attempts (keeps the whole call inside the server's time limit)
  const deadlineMs = options.deadlineMs || timeoutMs;
  const startedAt = Date.now();
  const remainingMs = () => deadlineMs - (Date.now() - startedAt);
  // A retry after a timeout only makes sense with at least this much time left
  const MIN_RETRY_WINDOW_MS = 8000;
  const { timeoutMs: _timeout, deadlineMs: _deadline, ...requestOptions } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingMs()));
    try {
      const signal = options.signal || (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(attemptTimeoutMs) : undefined);
      const fetchOptions = signal ? { ...requestOptions, signal } : requestOptions;
      const response = await fetchImpl(url, fetchOptions);

      if (response.ok) {
        return response;
      }

      if (!retryableStatusCodes.includes(response.status) || attempt === maxRetries) {
        return response;
      }

      const errorText = await response.text().catch(() => '');
      lastError = `Status ${response.status}: ${errorText}`;
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        // A slow answer gets one more try when there is still time; otherwise stop with a clear message
        if (attempt === maxRetries || options.signal || remainingMs() < MIN_RETRY_WINDOW_MS) {
          throw new HttpError(504, `AI request timed out after ${Math.round((Date.now() - startedAt) / 1000)} seconds. Please retry.`);
        }
        lastError = 'timed out';
        console.warn(`[AI Retry] Attempt ${attempt + 1} timed out after ${Math.round(attemptTimeoutMs / 1000)}s. Trying again.`);
        continue;
      }
      lastError = err.message || String(err);
      if (attempt === maxRetries) {
        throw new Error(`Request failed after ${maxRetries} retries: ${lastError}`);
      }
    }

    let delay = initialDelayMs * Math.pow(backoffFactor, attempt);
    if (jitter) {
      delay += Math.random() * 200;
    }

    console.warn(`[AI Retry] Request failed (${lastError}). Retrying attempt ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`Request failed after ${maxRetries} retries: ${lastError}`);
}
