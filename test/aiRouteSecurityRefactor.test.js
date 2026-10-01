import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as postAskBrain } from '../api/ask-brain.js';
import { POST as postEmbedMemory } from '../api/embed-memory.js';
import { POST as postObservePreference } from '../api/observe-preference.js';
import { POST as postExtractDocument } from '../api/extract-document.js';
import { resolveServerGeminiKey, sanitizeUpstreamAiError } from '../api/_lib/ai-auth.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('AI Route Security Refactor & Error Sanitization Suite', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.FIREBASE_WEB_API_KEY = 'test-api-key';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  function createMockRequest({ headers = {}, rawText = '', body = null, method = 'POST' } = {}) {
    const textContent = body !== null ? JSON.stringify(body) : rawText;
    const allHeaders = new Map(Object.entries({
      'authorization': 'Bearer valid-id-token',
      'content-type': 'application/json',
      ...headers
    }));

    return {
      method,
      url: 'http://localhost:3000/api/ai-endpoint',
      headers: {
        get: (key) => allHeaders.get(key.toLowerCase()) || null
      },
      text: async () => textContent,
      json: async () => JSON.parse(textContent)
    };
  }

  function mockAuthorizedAuth() {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            users: [{ localId: 'user_123', email: 'authorized-admin@sitetactix.com' }]
          })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ hasPreference: false }) }] } }],
            embeddings: [{ values: [0.1, 0.2, 0.3] }]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
  }

  // 1. observe-preference preserves 401/403 status
  it('observe-preference preserves a 401 unauthenticated status rather than returning 500', async () => {
    // Request without Authorization header
    const req = {
      method: 'POST',
      url: 'http://localhost:3000/api/observe-preference',
      headers: {
        get: () => null
      },
      text: async () => JSON.stringify({ query: 'hello' }),
      json: async () => ({ query: 'hello' })
    };

    const res = await postObservePreference(req);
    assert.strictEqual(res.status, 401, 'Should return HTTP 401 for unauthenticated request');
    const data = await res.json();
    assert.ok(data.error);
  });

  it('observe-preference preserves a 403 unauthorized status rather than returning 500', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'unauthorized_uid', email: 'stranger@example.com' }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        // Invite document not found
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const req = createMockRequest({
      body: { query: 'check balance' }
    });

    const res = await postObservePreference(req);
    assert.strictEqual(res.status, 403, 'Should return HTTP 403 for unauthorized invite');
    const data = await res.json();
    assert.ok(data.error);
  });

  // 2. Every AI route rejects client/Vite keys in production
  it('EVERY AI route strictly rejects client and Vite keys in production when GEMINI_API_KEY is unset', async () => {
    mockAuthorizedAuth();
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_API_KEY;
    process.env.VITE_GEMINI_API_KEY = 'insecure-vite-key';

    // Route 1: ask-brain
    const req1 = createMockRequest({
      body: { prompt: 'hi', apiKey: 'client-key' }
    });
    const res1 = await postAskBrain(req1);
    assert.strictEqual(res1.status, 503, 'ask-brain must return 503');

    // Route 2: embed-memory
    const req2 = createMockRequest({
      body: { text: 'test memory', apiKey: 'client-key' }
    });
    const res2 = await postEmbedMemory(req2);
    assert.strictEqual(res2.status, 503, 'embed-memory must return 503');

    // Route 3: observe-preference
    const req3 = createMockRequest({
      body: { query: 'test preference', apiKey: 'client-key' }
    });
    const res3 = await postObservePreference(req3);
    assert.strictEqual(res3.status, 503, 'observe-preference must return 503');

    // Route 4: extract-document
    const req4 = createMockRequest({
      headers: {
        'x-gemini-api-key': 'browser-key',
        'x-document-mime': 'application/pdf'
      }
    });
    const res4 = await postExtractDocument(req4);
    assert.strictEqual(res4.status, 503, 'extract-document must return 503');
  });

  // 3. Upstream errors are sanitized and provider internals omitted
  it('ask-brain: upstream Gemini 429 rate limit returns sanitized user message without provider internals', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'user_123', email: 'admin@sitetactix.com' }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        // Return simulated Gemini quota error with private GCP internal data
        return {
          ok: false,
          status: 429,
          text: async () => 'RESOURCE_EXHAUSTED: quota exceeded for project 987654321, metric: GenerateContentRequests'
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const req = createMockRequest({
      body: { prompt: 'How much for framing?' },
      headers: { 'x-disable-retry': 'true' }
    });

    const res = await postAskBrain(req);
    assert.strictEqual(res.status, 429);
    const data = await res.json();
    assert.ok(data.error.includes('high traffic'));
    assert.ok(!data.error.includes('987654321'), 'Must not leak GCP project numbers');
    assert.ok(!data.error.includes('RESOURCE_EXHAUSTED'), 'Must not leak provider error codes');
  });

  it('ask-brain: upstream Gemini 500/503 returns generic temporary-service message', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'user_123', email: 'admin@sitetactix.com' }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Backend internal crash in region us-central1-c: stack trace trace_xyz'
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const req = createMockRequest({
      body: { prompt: 'Test internal error' },
      headers: { 'x-disable-retry': 'true' }
    });

    const res = await postAskBrain(req);
    assert.strictEqual(res.status, 502);
    const data = await res.json();
    assert.ok(data.error.includes('temporarily unavailable'));
    assert.ok(!data.error.includes('us-central1-c'), 'Must not leak internal region names');
    assert.ok(!data.error.includes('trace_xyz'), 'Must not leak provider stack traces');
  });

  // 4. Lightweight schema guards in ask-brain
  it('ask-brain rejects malformed contents shapes with 400', async () => {
    mockAuthorizedAuth();

    // contents is not an array
    const req1 = createMockRequest({
      body: { contents: 'invalid-string-instead-of-array' }
    });
    const res1 = await postAskBrain(req1);
    assert.strictEqual(res1.status, 400);
    const data1 = await res1.json();
    assert.ok(data1.error.includes('contents must be an array'));

    // contents contains a primitive turn
    const req2 = createMockRequest({
      body: { contents: [12345] }
    });
    const res2 = await postAskBrain(req2);
    assert.strictEqual(res2.status, 400);
    const data2 = await res2.json();
    assert.ok(data2.error.includes('must be an object'));
  });

  // 5. sanitizeUpstreamAiError unit behavior
  it('sanitizeUpstreamAiError cleanly maps statuses without referencing response text', () => {
    const err429 = sanitizeUpstreamAiError(429);
    assert.strictEqual(err429.status, 429);
    assert.ok(err429.message.includes('high traffic'));

    const err500 = sanitizeUpstreamAiError(500);
    assert.strictEqual(err500.status, 502);
    assert.ok(err500.message.includes('temporarily unavailable'));

    const err503 = sanitizeUpstreamAiError(503);
    assert.strictEqual(err503.status, 502);
    assert.ok(err503.message.includes('temporarily unavailable'));

    const err504 = sanitizeUpstreamAiError(504);
    assert.strictEqual(err504.status, 504);
    assert.ok(err504.message.includes('timed out'));
  });

  // 6. Volume & batch limits on embed-memory and observe-preference
  it('embed-memory: rejects batch size exceeding 50 items with 400', async () => {
    mockAuthorizedAuth();

    const largeBatch = Array.from({ length: 51 }, (_, i) => `Memory text chunk ${i}`);
    const req = createMockRequest({
      body: { texts: largeBatch }
    });

    const res = await postEmbedMemory(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('50 items'));
  });

  it('embed-memory: rejects total character volume exceeding 20,000 characters with 400', async () => {
    mockAuthorizedAuth();

    // 5 items of 4,500 chars = 22,500 chars total
    const largeChunk = 'A'.repeat(4500);
    const largeVolume = Array.from({ length: 5 }, () => largeChunk);
    const req = createMockRequest({
      body: { texts: largeVolume }
    });

    const res = await postEmbedMemory(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('20,000 characters'));
  });

  it('observe-preference: rejects query exceeding 2,000 characters with 400', async () => {
    mockAuthorizedAuth();

    const hugeQuery = 'Q'.repeat(2001);
    const req = createMockRequest({
      body: { query: hugeQuery }
    });

    const res = await postObservePreference(req);
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('2,000 characters'));
  });

  // 7. Timeout handling with mocked aborted requests (fast, 0s delay)
  it('fetchWithExponentialBackoff handles timeout/abort cleanly without waiting', async () => {
    const mockTimeoutFetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    };

    await assert.rejects(
      async () => {
        await fetchWithExponentialBackoff(
          'https://example.com/api',
          { timeoutMs: 100 },
          { maxRetries: 0 },
          mockTimeoutFetch
        );
      },
      /timed out/
    );
  });



  it('ask-brain route returns HTTP 504 when upstream Gemini request times out', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'user_123', email: 'admin@sitetactix.com' }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const req = createMockRequest({
      body: { prompt: 'How much for framing?' },
      headers: { 'x-disable-retry': 'true' }
    });

    const res = await postAskBrain(req);
    assert.strictEqual(res.status, 504, 'Route should return HTTP 504 on Gemini timeout');
    const data = await res.json();
    assert.ok(data.error.includes('timed out'));
  });
});
