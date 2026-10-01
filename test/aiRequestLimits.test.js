import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../api/ask-brain.js';
import { POST as postExtractDocument } from '../api/extract-document.js';
import { POST as postObservePreference } from '../api/observe-preference.js';

describe('AI Request Limits & Conversation Caps Test Suite', () => {
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

  function createMockRequest({ headers = {}, rawText = '', body = null } = {}) {
    const textContent = body !== null ? JSON.stringify(body) : rawText;
    const allHeaders = new Map(Object.entries({
      'authorization': 'Bearer valid-id-token',
      'content-type': 'application/json',
      ...headers
    }));

    return {
      url: 'http://localhost:3000/api/ask-brain',
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
            users: [{ localId: 'user_123', email: 'authorized-admin@sitetactix.com', emailVerified: true }]
          })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({})
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: 'Answer from AI' }]
              }
            }]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
  }

  it('rejects oversized requests early when Content-Length header exceeds 100 KB', async () => {
    mockAuthorizedAuth();

    const request = createMockRequest({
      headers: {
        'content-length': String(105 * 1024) // 105 KB
      },
      body: { prompt: 'Hello' }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 413);
    const data = await response.json();
    assert.ok(data.error.includes('100 KB'));
  });

  it('rejects oversized requests when actual body bytes exceed 100 KB without relying on Content-Length', async () => {
    mockAuthorizedAuth();

    // Create a 105 KB payload body without Content-Length header
    const largePrompt = 'A'.repeat(105 * 1024);
    const request = createMockRequest({
      rawText: JSON.stringify({ prompt: largePrompt })
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 413);
    const data = await response.json();
    assert.ok(data.error.includes('100 KB'));
  });

  it('accepts a realistic large J.A.R.V.I.S. system prompt around 45,000 characters and returns HTTP 200', async () => {
    mockAuthorizedAuth();

    const realisticInstruction = 'A'.repeat(45000);
    const request = createMockRequest({
      body: {
        prompt: 'Hello Jarvis',
        systemInstruction: realisticInstruction
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 200, '45,000 character prompt must return HTTP 200');
    const data = await response.json();
    assert.strictEqual(data.text, 'Answer from AI');
  });

  it('rejects system instructions exceeding 80,000 characters with 400', async () => {
    mockAuthorizedAuth();

    const longInstruction = 'B'.repeat(80001);
    const request = createMockRequest({
      body: {
        prompt: 'Hello',
        systemInstruction: longInstruction
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.ok(data.error.includes('80,000 characters'));
  });

  it('rejects conversations exceeding 30 turns with 400', async () => {
    mockAuthorizedAuth();

    const turns = [];
    for (let i = 0; i < 32; i++) {
      turns.push({
        role: i % 2 === 0 ? 'user' : 'model',
        parts: [{ text: `Turn number ${i}` }]
      });
    }

    const request = createMockRequest({
      body: {
        contents: turns
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.ok(data.error.includes('30 turns'));
  });

  it('rejects conversations exceeding 50,000 total characters with 400', async () => {
    mockAuthorizedAuth();

    // 5 turns of 11,000 characters each = 55,000 chars total
    const largeChunk = 'C'.repeat(11000);
    const turns = [
      { role: 'user', parts: [{ text: largeChunk }] },
      { role: 'model', parts: [{ text: largeChunk }] },
      { role: 'user', parts: [{ text: largeChunk }] },
      { role: 'model', parts: [{ text: largeChunk }] },
      { role: 'user', parts: [{ text: largeChunk }] }
    ];

    const request = createMockRequest({
      body: {
        contents: turns
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.ok(data.error.includes('50,000 characters'));
  });

  it('accepts valid queries and conversation histories within calibrated limits', async () => {
    mockAuthorizedAuth();

    const turns = [
      { role: 'user', parts: [{ text: 'What is the plumbing balance?' }] },
      { role: 'model', parts: [{ text: 'The remaining balance is $10,000.' }] },
      { role: 'user', parts: [{ text: 'Who is the contractor?' }] }
    ];

    const request = createMockRequest({
      body: {
        contents: turns,
        systemInstruction: 'You are an intelligent construction assistant.'
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.text, 'Answer from AI');
  });

  it('returns 400 when reading request body fails', async () => {
    mockAuthorizedAuth();

    const faultyRequest = {
      url: 'http://localhost:3000/api/ask-brain',
      headers: {
        get: (key) => key.toLowerCase() === 'authorization' ? 'Bearer valid-id-token' : null
      },
      text: async () => { throw new Error('Stream terminated prematurely'); },
      json: async () => { throw new Error('Stream terminated prematurely'); }
    };

    const response = await POST(faultyRequest);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.ok(data.error.includes('Failed to read request body'));
  });

  it('in production mode, strictly ignores client-supplied keys and VITE_GEMINI_API_KEY fallback', async () => {
    mockAuthorizedAuth();
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_API_KEY;
    process.env.VITE_GEMINI_API_KEY = 'client-facing-vite-key';

    const request = createMockRequest({
      body: {
        prompt: 'Hello',
        apiKey: 'client-injected-gemini-key'
      }
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 503);
    const data = await response.json();
    assert.ok(data.error.includes('GEMINI_API_KEY'));
  });

  it('extract-document: in production, ignores browser x-gemini-api-key and omits Settings reference', async () => {
    mockAuthorizedAuth();
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_API_KEY;

    const request = createMockRequest({
      headers: {
        'x-gemini-api-key': 'browser-supplied-key',
        'x-document-mime': 'application/pdf'
      }
    });

    const response = await postExtractDocument(request);
    assert.strictEqual(response.status, 503);
    const data = await response.json();
    assert.ok(data.error.includes('GEMINI_API_KEY'));
    assert.ok(!data.error.includes('save your key in Settings'), 'Production error must not suggest saving key in Settings');
  });

  it('observe-preference: sends Gemini key in x-goog-api-key header and never in URL query string', async () => {
    process.env.NODE_ENV = 'production';
    process.env.GEMINI_API_KEY = 'TEST_GEMINI_OBSERVER_SECRET_999';

    let capturedUrl = '';
    let capturedHeaders = null;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('identitytoolkit.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ users: [{ localId: 'user_123', email: 'admin@sitetactix.com', emailVerified: true }] })
        };
      }
      if (urlStr.includes('firestore.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        capturedUrl = urlStr;
        capturedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ hasPreference: false }) }] } }]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const request = createMockRequest({
      body: { query: 'Show me all electrical invoices' }
    });

    const response = await postObservePreference(request);
    assert.strictEqual(response.status, 200);

    // Verify key is in header
    assert.strictEqual(
      capturedHeaders?.['x-goog-api-key'],
      'TEST_GEMINI_OBSERVER_SECRET_999',
      'Outbound request must provide secret in x-goog-api-key header'
    );

    // Verify secret is NEVER in URL query string
    assert.ok(
      !capturedUrl.includes('?key='),
      'Outbound URL must not have ?key= query parameter'
    );
    assert.ok(
      !capturedUrl.includes('TEST_GEMINI_OBSERVER_SECRET_999'),
      'Outbound URL must never contain the secret key string'
    );
  });
});

