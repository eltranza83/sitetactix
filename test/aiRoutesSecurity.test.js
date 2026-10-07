import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as postExtractDocument } from '../api/extract-document.js';
import { sanitizeUpstreamAiError } from '../api/_lib/ai-auth.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('AI scan route: auth, keys, request limits and error sanitization', () => {
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

  function scanRequest({ headers = {}, bytes = new Uint8Array([1, 2, 3, 4]), noAuth = false } = {}) {
    const allHeaders = new Map(Object.entries({
      ...(noAuth ? {} : { authorization: 'Bearer valid-id-token' }),
      'content-type': 'application/octet-stream',
      'x-document-mime': 'image/jpeg',
      ...headers
    }));
    return {
      url: 'http://localhost:3000/api/extract-document',
      headers: { get: (key) => allHeaders.get(key.toLowerCase()) ?? null },
      arrayBuffer: async () => bytes.buffer
    };
  }

  const scanReply = JSON.stringify({
    type: 'receipt', description: 'Fuel', vendor: 'Stripes', costCategory: 'material',
    amount: 50, date: '2026-10-07', tradeCategory: 'Project_Overhead_&_Bills', tradePhase: 'Extra Costs & Misc'
  });

  // Authorized user + a configurable Gemini reply.
  function mockUpstream(gemini = () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: scanReply }] } }] })
  })) {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'user_123', email: 'authorized-admin@sitetactix.com', emailVerified: true }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        calls.push({ url: urlStr, options });
        return gemini(urlStr, options);
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    return calls;
  }

  describe('auth and keys', () => {
    it('rejects an unauthenticated scan with 401', async () => {
      mockUpstream();
      const res = await postExtractDocument(scanRequest({ noAuth: true }));
      assert.strictEqual(res.status, 401);
    });

    it('ignores browser-supplied keys in production when GEMINI_API_KEY is unset', async () => {
      mockUpstream();
      process.env.NODE_ENV = 'production';
      delete process.env.GEMINI_API_KEY;
      process.env.VITE_GEMINI_API_KEY = 'insecure-vite-key';

      const res = await postExtractDocument(scanRequest({ headers: { 'x-gemini-api-key': 'browser-supplied-key' } }));
      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.ok(data.error.includes('GEMINI_API_KEY'));
      assert.ok(!data.error.includes('save your key in Settings'), 'Production error must not suggest saving a key in Settings');
    });

    it('sends the Gemini key in the x-goog-api-key header and never in the URL', async () => {
      process.env.NODE_ENV = 'production';
      process.env.GEMINI_API_KEY = 'TEST_SECRET_KEY_999';
      const calls = mockUpstream();

      const res = await postExtractDocument(scanRequest());
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).data.vendor, 'Stripes');
      assert.strictEqual(calls.length, 1);
      assert.ok(!calls[0].url.includes('TEST_SECRET_KEY_999'), 'key must not be in the URL');
      assert.ok(!calls[0].url.includes('key='), 'no key= query parameter');
      assert.strictEqual(calls[0].options.headers['x-goog-api-key'], 'TEST_SECRET_KEY_999');
    });
  });

  describe('request limits', () => {
    it('rejects files declared larger than 4 MB with 413', async () => {
      mockUpstream();
      const res = await postExtractDocument(scanRequest({ headers: { 'content-length': String(5 * 1024 * 1024) } }));
      assert.strictEqual(res.status, 413);
    });

    it('rejects unsupported file types with 415', async () => {
      mockUpstream();
      const res = await postExtractDocument(scanRequest({ headers: { 'x-document-mime': 'text/html' } }));
      assert.strictEqual(res.status, 415);
    });

    it('rejects an empty file with 400', async () => {
      mockUpstream();
      const res = await postExtractDocument(scanRequest({ bytes: new Uint8Array([]) }));
      assert.strictEqual(res.status, 400);
    });
  });

  describe('upstream errors are sanitized', () => {
    it('Gemini 429 returns a friendly message without provider internals', async () => {
      mockUpstream(() => ({
        ok: false,
        status: 429,
        text: async () => 'RESOURCE_EXHAUSTED: quota exceeded for project 987654321'
      }));
      const res = await postExtractDocument(scanRequest());
      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.ok(data.error.includes('high traffic'));
      assert.ok(!data.error.includes('987654321'), 'Must not leak GCP project numbers');
      assert.ok(!data.error.includes('RESOURCE_EXHAUSTED'), 'Must not leak provider error codes');
    });

    it('Gemini 503 returns a generic temporary-service message', async () => {
      mockUpstream(() => ({ ok: false, status: 503, text: async () => 'internal backend detail xyz' }));
      const res = await postExtractDocument(scanRequest());
      assert.strictEqual(res.status, 502);
      const data = await res.json();
      assert.ok(data.error.includes('temporarily unavailable'));
      assert.ok(!data.error.includes('xyz'));
    });

    it('a Gemini timeout returns HTTP 504', async () => {
      mockUpstream(() => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      });
      const res = await postExtractDocument(scanRequest());
      assert.strictEqual(res.status, 504);
      assert.ok((await res.json()).error.includes('timed out'));
    });

    it('sanitizeUpstreamAiError maps statuses without referencing response text', () => {
      const err429 = sanitizeUpstreamAiError(429);
      assert.strictEqual(err429.status, 429);
      assert.ok(err429.message.includes('high traffic'));

      for (const code of [500, 503]) {
        const err = sanitizeUpstreamAiError(code);
        assert.strictEqual(err.status, 502);
        assert.ok(err.message.includes('temporarily unavailable'));
      }

      const err504 = sanitizeUpstreamAiError(504);
      assert.strictEqual(err504.status, 504);
      assert.ok(err504.message.includes('timed out'));
    });

    it('fetchWithExponentialBackoff handles timeout/abort cleanly without waiting', async () => {
      const mockTimeoutFetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'TimeoutError';
        throw err;
      };
      await assert.rejects(
        () => fetchWithExponentialBackoff('https://example.com/api', { timeoutMs: 100 }, { maxRetries: 0 }, mockTimeoutFetch),
        /timed out/
      );
    });
  });
});
