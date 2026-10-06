import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as postJarvis } from '../api/jarvis.js';
import { POST as postExtractDocument } from '../api/extract-document.js';
import { sanitizeUpstreamAiError } from '../api/_lib/ai-auth.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('AI routes (Jarvis + document scan): request limits, auth and error sanitization', () => {
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

  const userTurn = (text) => ({ role: 'user', parts: [{ text }] });

  function createMockRequest({ headers = {}, rawText = '', body = null, noAuth = false } = {}) {
    const textContent = body !== null ? JSON.stringify(body) : rawText;
    const allHeaders = new Map(Object.entries({
      ...(noAuth ? {} : { authorization: 'Bearer valid-id-token' }),
      'content-type': 'application/json',
      ...headers
    }));

    return {
      url: 'http://localhost:3000/api/jarvis',
      headers: { get: (key) => allHeaders.get(key.toLowerCase()) || null },
      text: async () => textContent,
      json: async () => JSON.parse(textContent)
    };
  }

  // Authorized user + a configurable Gemini reply.
  function mockUpstream(gemini = () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'Answer from AI' }] } }] })
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

  describe('request limits', () => {
    it('rejects oversized requests early when Content-Length exceeds 100 KB', async () => {
      mockUpstream();
      const res = await postJarvis(createMockRequest({
        headers: { 'content-length': String(105 * 1024) },
        body: { contents: [userTurn('Hello')] }
      }));
      assert.strictEqual(res.status, 413);
      assert.ok((await res.json()).error.includes('100 KB'));
    });

    it('rejects oversized bodies even without a Content-Length header', async () => {
      mockUpstream();
      const res = await postJarvis(createMockRequest({
        rawText: JSON.stringify({ contents: [userTurn('A'.repeat(105 * 1024))] })
      }));
      assert.strictEqual(res.status, 413);
      assert.ok((await res.json()).error.includes('100 KB'));
    });

    it('accepts a long conversation turn (~45,000 characters) and answers', async () => {
      mockUpstream();
      const res = await postJarvis(createMockRequest({
        body: { contents: [userTurn('A'.repeat(45000))], projectName: 'Lot 3' }
      }));
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await res.json()).text, 'Answer from AI');
    });

    it('rejects missing, empty or non-array contents with 400', async () => {
      mockUpstream();
      for (const body of [{}, { contents: [] }, { contents: 'not-an-array' }]) {
        const res = await postJarvis(createMockRequest({ body }));
        assert.strictEqual(res.status, 400);
        assert.ok((await res.json()).error.includes('contents must be a non-empty array'));
      }
    });

    it('returns 400 when reading the request body fails', async () => {
      mockUpstream();
      const req = createMockRequest({ body: { contents: [userTurn('Hi')] } });
      req.text = async () => { throw new Error('stream broke'); };
      const res = await postJarvis(req);
      assert.strictEqual(res.status, 400);
      assert.ok((await res.json()).error.includes('Failed to read request body'));
    });
  });

  describe('auth and keys', () => {
    it('rejects an unauthenticated Jarvis request with 401', async () => {
      mockUpstream();
      const res = await postJarvis(createMockRequest({ noAuth: true, body: { contents: [userTurn('Hi')] } }));
      assert.strictEqual(res.status, 401);
    });

    it('EVERY AI route rejects client and Vite keys in production when GEMINI_API_KEY is unset', async () => {
      mockUpstream();
      process.env.NODE_ENV = 'production';
      delete process.env.GEMINI_API_KEY;
      process.env.VITE_GEMINI_API_KEY = 'insecure-vite-key';

      const jarvis = await postJarvis(createMockRequest({
        body: { contents: [userTurn('hi')], apiKey: 'client-injected-key' }
      }));
      assert.strictEqual(jarvis.status, 503);
      assert.ok((await jarvis.json()).error.includes('GEMINI_API_KEY'));

      const scan = await postExtractDocument(createMockRequest({
        headers: { 'x-gemini-api-key': 'browser-supplied-key', 'x-document-mime': 'application/pdf' }
      }));
      assert.strictEqual(scan.status, 503);
      const scanData = await scan.json();
      assert.ok(scanData.error.includes('GEMINI_API_KEY'));
      assert.ok(!scanData.error.includes('save your key in Settings'), 'Production error must not suggest saving a key in Settings');
    });

    it('Jarvis sends the Gemini key in the x-goog-api-key header and never in the URL', async () => {
      process.env.NODE_ENV = 'production';
      process.env.GEMINI_API_KEY = 'TEST_SECRET_KEY_999';
      const calls = mockUpstream();

      const res = await postJarvis(createMockRequest({ body: { contents: [userTurn('Hi')] } }));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(calls.length, 1);
      assert.ok(!calls[0].url.includes('TEST_SECRET_KEY_999'), 'key must not be in the URL');
      assert.ok(!calls[0].url.includes('key='), 'no key= query parameter');
      assert.strictEqual(calls[0].options.headers['x-goog-api-key'], 'TEST_SECRET_KEY_999');
    });
  });

  describe('upstream errors are sanitized', () => {
    it('Gemini 429 returns a friendly message without provider internals', async () => {
      mockUpstream(() => ({
        ok: false,
        status: 429,
        text: async () => 'RESOURCE_EXHAUSTED: quota exceeded for project 987654321'
      }));
      const res = await postJarvis(createMockRequest({ body: { contents: [userTurn('How much for framing?')] } }));
      assert.strictEqual(res.status, 429);
      const data = await res.json();
      assert.ok(data.error.includes('high traffic'));
      assert.ok(!data.error.includes('987654321'), 'Must not leak GCP project numbers');
      assert.ok(!data.error.includes('RESOURCE_EXHAUSTED'), 'Must not leak provider error codes');
    });

    it('Gemini 503 returns a generic temporary-service message', async () => {
      mockUpstream(() => ({ ok: false, status: 503, text: async () => 'internal backend detail xyz' }));
      const res = await postJarvis(createMockRequest({ body: { contents: [userTurn('Hi')] } }));
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
      const res = await postJarvis(createMockRequest({ body: { contents: [userTurn('Hi')] } }));
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
