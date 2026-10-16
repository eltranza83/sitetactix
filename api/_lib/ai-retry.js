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
  // retryAfterTimeout false: a model that hung once is not asked again (a backup model is waiting)
  const { timeoutMs: _timeout, deadlineMs: _deadline, retryAfterTimeout = true, ...requestOptions } = options;
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
        if (attempt === maxRetries || options.signal || !retryAfterTimeout || remainingMs() < MIN_RETRY_WINDOW_MS) {
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

/** The Gemini address for one model. */
export function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

// Google answers these when a model is overloaded, out of quota, failing or stuck: the backup model may still work
const BACKUP_MODEL_STATUSES = [429, 500, 502, 503, 504];
// The backup model is only tried when at least this much of the time limit is left
const MIN_BACKUP_WINDOW_MS = 10000;

/**
 * Sends one Gemini request to the main model (with its retries). If Google still says that model
 * is busy, out of quota, failing or stuck, or the model does not answer in time (or the connection
 * drops), the same request goes to the backup model. A model that hangs is not retried when a
 * backup is waiting, so the backup still has time. All tries together stay within
 * options.deadlineMs (or timeoutMs), so the server's time limit is never passed.
 * @param {string[]} models - main model first, then the backup (duplicates and blanks are skipped)
 * @param {(model: string) => string} urlForModel
 * @returns {Promise<{ response: Response, model: string }>} the last answer and which model gave it
 */
export async function fetchWithBackupModel(models, urlForModel, options = {}, retryConfig, fetchImpl = fetch) {
  const modelList = [...new Set((models || []).filter(Boolean))];
  const timeoutMs = options.timeoutMs || 25000;
  const deadlineMs = options.deadlineMs || timeoutMs;
  const startedAt = Date.now();
  let last = null;

  for (const [index, model] of modelList.entries()) {
    const remainingMs = deadlineMs - (Date.now() - startedAt);
    const hasBackup = index < modelList.length - 1;
    if (index > 0 && remainingMs < MIN_BACKUP_WINDOW_MS) break;

    try {
      const response = await fetchWithExponentialBackoff(
        urlForModel(model),
        { ...options, timeoutMs: Math.min(timeoutMs, remainingMs), deadlineMs: remainingMs, retryAfterTimeout: !hasBackup },
        retryConfig,
        fetchImpl
      );
      last = { response, model };
      if (response.ok || !BACKUP_MODEL_STATUSES.includes(response.status)) return last;
      if (hasBackup) console.warn(`[AI] ${model} answered ${response.status}; trying the backup model ${modelList[index + 1]}.`);
    } catch (err) {
      // No answer in time, or the connection dropped: the backup gets the rest of the time
      const canTryBackup = hasBackup && deadlineMs - (Date.now() - startedAt) >= MIN_BACKUP_WINDOW_MS;
      if (!canTryBackup) {
        if (last) return last;
        throw err;
      }
      console.warn(`[AI] ${model} did not answer (${err?.message || err}); trying the backup model ${modelList[index + 1]}.`);
    }
  }
  return last;
}
