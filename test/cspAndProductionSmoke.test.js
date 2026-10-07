import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('CSP & Production Security Headers Smoke Test Suite', () => {
  const vercelConfig = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  );

  const globalRule = vercelConfig.headers?.find(h => h.source === '/(.*)');
  assert.ok(globalRule, 'Global header rule for /(.*) must exist in vercel.json');

  const headersMap = new Map(globalRule.headers.map(h => [h.key, h.value]));
  const csp = headersMap.get('Content-Security-Policy') || '';

  function parseCspDirectives(cspString) {
    const directives = {};
    const parts = cspString.split(';').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const [name, ...values] = part.split(/\s+/);
      directives[name] = values;
    }
    return directives;
  }

  const parsed = parseCspDirectives(csp);

  it('enforces strict anti-clickjacking and browser defense headers', () => {
    assert.strictEqual(headersMap.get('X-Frame-Options'), 'DENY', 'X-Frame-Options must be DENY');
    assert.strictEqual(headersMap.get('X-Content-Type-Options'), 'nosniff', 'X-Content-Type-Options must be nosniff');
    assert.strictEqual(headersMap.get('Referrer-Policy'), 'strict-origin-when-cross-origin', 'Referrer-Policy must be strict-origin-when-cross-origin');
    assert.ok(headersMap.get('Permissions-Policy'), 'Permissions-Policy must be configured');
    assert.deepStrictEqual(parsed['frame-ancestors'], ["'none'"], "CSP frame-ancestors must be 'none'");
    assert.deepStrictEqual(parsed['object-src'], ["'none'"], "CSP object-src must be 'none'");
  });

  it('keeps script-src and connect-src strictly scoped without wildcards or unsafe-eval', () => {
    const connectSrc = parsed['connect-src'] || [];
    const scriptSrc = parsed['script-src'] || [];

    assert.ok(!scriptSrc.includes("'unsafe-eval'"), "script-src must NOT allow 'unsafe-eval'");
    assert.ok(!connectSrc.includes('*'), "connect-src must NOT contain wildcard '*'");
    assert.ok(!connectSrc.some(origin => origin.includes('http:')), 'connect-src must never allow insecure http: origins');
  });

  it('authorizes Google Sign-In and Firebase Auth endpoints in CSP', () => {
    const connectSrc = parsed['connect-src'] || [];
    const scriptSrc = parsed['script-src'] || [];
    const frameSrc = parsed['frame-src'] || [];

    // Google Identity Services (GIS)
    assert.ok(scriptSrc.includes('https://apis.google.com'), 'Google APIs script must be allowed');
    assert.ok(scriptSrc.includes('https://accounts.google.com'), 'Google Accounts script must be allowed');
    assert.ok(connectSrc.includes('https://accounts.google.com'), 'Google Identity connect must be allowed');
    assert.ok(frameSrc.includes('https://accounts.google.com'), 'Google Accounts popup/iframe must be allowed');

    // Firebase Auth Identity Toolkit & Token Refresh
    assert.ok(connectSrc.includes('https://identitytoolkit.googleapis.com'), 'Firebase identitytoolkit must be in connect-src');
    assert.ok(connectSrc.includes('https://securetoken.googleapis.com'), 'Firebase securetoken must be in connect-src');
    assert.ok(frameSrc.includes('https://adepec-scanner-invites.firebaseapp.com'), 'Firebase authDomain iframe must be in frame-src');
  });

  it('authorizes Google Drive and Sheets API endpoints in CSP', () => {
    const connectSrc = parsed['connect-src'] || [];

    assert.ok(connectSrc.includes('https://www.googleapis.com'), 'Google APIs (Drive) must be in connect-src');
    assert.ok(connectSrc.includes('https://sheets.googleapis.com'), 'Google Sheets API must be in connect-src');
  });

  it('authorizes Firestore database endpoints in CSP', () => {
    const connectSrc = parsed['connect-src'] || [];

    assert.ok(connectSrc.includes('https://firestore.googleapis.com'), 'Firestore REST API must be in connect-src');
  });

  it('authorizes blueprint and receipt images in CSP, with no embedded Drive pages', () => {
    const imgSrc = parsed['img-src'] || [];
    const frameSrc = parsed['frame-src'] || [];

    // Image/PDF rendering in the Blueprint Pinboard and receipts
    assert.ok(imgSrc.includes('blob:'), "img-src must allow 'blob:' for dynamically rendered blueprints and receipts");
    assert.ok(imgSrc.includes('data:'), "img-src must allow 'data:' URIs");
    assert.ok(imgSrc.includes('https://lh3.googleusercontent.com'), 'img-src must allow Google profile pictures');

    // The in-app Drive document viewer was removed with Jarvis (v1.7.0)
    assert.ok(!frameSrc.includes('https://drive.google.com'), 'frame-src must not allow embedding drive.google.com');
  });

  it('sends AI requests only through the app server', () => {
    const connectSrc = parsed['connect-src'] || [];

    assert.ok(connectSrc.includes("'self'"), "connect-src must allow 'self' for /api/extract-document");
    assert.ok(!connectSrc.includes('https://generativelanguage.googleapis.com'), 'the browser must never call Gemini directly');
  });

  it('allows the camera but not the microphone or location', () => {
    const permissions = headersMap.get('Permissions-Policy') || '';

    assert.ok(permissions.includes('camera=(self)'), 'camera must stay allowed for scanning');
    assert.ok(permissions.includes('microphone=()'), 'microphone must be off (voice was removed with Jarvis)');
    assert.ok(permissions.includes('geolocation=()'), 'location must be off');
  });
});

