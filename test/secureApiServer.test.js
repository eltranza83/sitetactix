import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HttpError,
  getBearerToken,
  requireScannerAccess,
  verifyFirebaseIdentity
} from '../api/_lib/firebase-auth.js';
import { generateDocumentData } from '../api/extract-document.js';

test('getBearerToken accepts only bearer authorization', () => {
  assert.equal(getBearerToken(new Request('https://example.test')), '');
  assert.equal(getBearerToken(new Request('https://example.test', { headers: { authorization: 'Bearer token-1' } })), 'token-1');
});

test('verifyFirebaseIdentity rejects a missing token', async () => {
  await assert.rejects(() => verifyFirebaseIdentity('', async () => null), (error) => {
    assert.equal(error instanceof HttpError, true);
    assert.equal(error.status, 401);
    return true;
  });
});

test('requireScannerAccess verifies identity and an access document', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).includes('accounts:lookup')) {
      return Response.json({ users: [{ localId: 'uid-1', email: 'Builder@Example.com', emailVerified: true }] });
    }
    if (String(url).includes('/admins/')) return new Response('', { status: 404 });
    return Response.json({ name: 'access' });
  };

  const user = await requireScannerAccess(new Request('https://example.test', {
    headers: { authorization: 'Bearer firebase-token' }
  }), fetchImpl);

  assert.deepEqual(user, { uid: 'uid-1', email: 'builder@example.com' });
  assert.equal(requested.some((url) => url.includes('user_access/uid-1')), true);
});

test('generateDocumentData sends inline bytes and parses Gemini JSON', async () => {
  let requestBody;
  const data = await generateDocumentData({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    apiKey: 'server-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      assert.equal(options.headers['x-goog-api-key'], 'server-key');
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"vendor":"Test"}' }] } }] });
    }
  });

  assert.deepEqual(data, { vendor: 'Test' });
  assert.equal(requestBody.contents[0].parts[1].inlineData.data, 'AQID');
});

test('requireScannerAccess rejects unauthenticated request with 401', async () => {
  const req = new Request('https://example.test/api/ask-brain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test' })
  });

  await assert.rejects(
    () => requireScannerAccess(req, async () => null),
    (err) => {
      assert.equal(err instanceof HttpError, true);
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Sign in is required.');
      return true;
    }
  );
});

test('requireScannerAccess rejects unauthorized user without invite document with 403', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('accounts:lookup')) {
      return Response.json({ users: [{ localId: 'unauthorized-uid', email: 'intruder@example.com', emailVerified: true }] });
    }
    // No admin doc, no user_access doc
    return new Response('', { status: 404 });
  };

  const req = new Request('https://example.test/api/ask-brain', {
    method: 'POST',
    headers: { authorization: 'Bearer invalid-access-token' }
  });

  await assert.rejects(
    () => requireScannerAccess(req, fetchImpl),
    (err) => {
      assert.equal(err instanceof HttpError, true);
      assert.equal(err.status, 403);
      assert.equal(err.message, 'Scanner access is not authorized for this account.');
      return true;
    }
  );
});

test('requireScannerAccess rejects user with unverified email with 403', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('accounts:lookup')) {
      return Response.json({ users: [{ localId: 'unverified-uid', email: 'unverified@example.com', emailVerified: false }] });
    }
    return Response.json({ name: 'access' });
  };

  const req = new Request('https://example.test/api/ask-brain', {
    method: 'POST',
    headers: { authorization: 'Bearer unverified-token' }
  });

  await assert.rejects(
    () => requireScannerAccess(req, fetchImpl),
    (err) => {
      assert.equal(err instanceof HttpError, true);
      assert.equal(err.status, 403);
      assert.equal(err.message, 'Email verification is required.');
      return true;
    }
  );
});

test('requireScannerAccess enforces rate limits when threshold exceeded', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('accounts:lookup')) {
      return Response.json({ users: [{ localId: 'rate-limit-test-uid', email: 'builder@example.com', emailVerified: true }] });
    }
    return Response.json({ name: 'access' });
  };

  const req = new Request('https://example.test/api/ask-brain', {
    headers: { authorization: 'Bearer valid-token' }
  });

  // Call within limit
  const user = await requireScannerAccess(req, fetchImpl, { rateLimit: 2, windowMs: 10000 });
  assert.equal(user.uid, 'rate-limit-test-uid');

  await requireScannerAccess(req, fetchImpl, { rateLimit: 2, windowMs: 10000 });

  // Exceed limit
  await assert.rejects(
    () => requireScannerAccess(req, fetchImpl, { rateLimit: 2, windowMs: 10000 }),
    (err) => {
      assert.equal(err instanceof HttpError, true);
      assert.equal(err.status, 429);
      return true;
    }
  );
});

