import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { AI_CONFIG } from '../src/config/aiConfig.js';
import { AI_CONFIG as SERVER_AI_CONFIG } from '../api/_lib/ai-config.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('Centralized AI Configuration', () => {
  test('the single model default is Flash-Lite on both the app and the server', () => {
    assert.equal(AI_CONFIG.primaryModel, 'gemini-3.1-flash-lite');
    assert.equal(SERVER_AI_CONFIG.primaryModel, 'gemini-3.1-flash-lite');
  });

  test('the old reasoning-model routing is gone', () => {
    assert.equal(AI_CONFIG.reasoningModel, undefined);
    assert.equal(SERVER_AI_CONFIG.reasoningModel, undefined);
  });

  test('retry and generation settings exist for the server routes', () => {
    assert.ok(SERVER_AI_CONFIG.retry.maxRetries >= 1);
    assert.ok(SERVER_AI_CONFIG.retry.retryableStatusCodes.includes(429));
    assert.ok(SERVER_AI_CONFIG.generation.maxOutputTokens > 0);
  });
});

describe('Exponential Backoff Retry Engine', () => {
  test('retries on HTTP 429 / 503 errors and succeeds on recovery', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 2) {
        return { ok: false, status: 503, text: async () => 'Service Unavailable' };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };

    const response = await fetchWithExponentialBackoff(
      'https://example.com/api',
      {},
      { maxRetries: 2, initialDelayMs: 10, backoffFactor: 2, jitter: false, retryableStatusCodes: [503] },
      mockFetch
    );

    assert.equal(attempts, 2);
    assert.equal(response.ok, true);
  });
});
