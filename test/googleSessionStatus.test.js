import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGoogleTokenAgeMs,
  shouldRenewGoogleToken,
  getGoogleConnectionStatus,
  GOOGLE_TOKEN_LIFETIME_MS,
  GOOGLE_TOKEN_RENEW_AFTER_MS
} from '../src/services/googleSessionStatus.js';

const MIN = 60 * 1000;
const now = 1_800_000_000_000;

describe('Google sign-in dot in the top bar', () => {
  test('token age: none, unknown (old app versions), and measured', () => {
    assert.equal(getGoogleTokenAgeMs({ token: null, issuedAt: String(now), now }), null);
    assert.equal(getGoogleTokenAgeMs({ token: 'tok', issuedAt: null, now }), Infinity);
    assert.equal(getGoogleTokenAgeMs({ token: 'tok', issuedAt: String(now - 10 * MIN), now }), 10 * MIN);
  });

  test('the next tap renews from 50 minutes on (and when there is no token)', () => {
    assert.equal(GOOGLE_TOKEN_RENEW_AFTER_MS, 50 * MIN);
    assert.equal(shouldRenewGoogleToken(10 * MIN), false);
    assert.equal(shouldRenewGoogleToken(50 * MIN), true);
    assert.equal(shouldRenewGoogleToken(Infinity), true);
    assert.equal(shouldRenewGoogleToken(null), true);
  });

  test('green until the pass actually runs out at one hour, then amber', () => {
    assert.equal(GOOGLE_TOKEN_LIFETIME_MS, 60 * MIN);
    assert.equal(getGoogleConnectionStatus({ ageMs: 5 * MIN, hasGoogleUser: true }), 'connected');
    assert.equal(getGoogleConnectionStatus({ ageMs: 55 * MIN, hasGoogleUser: true }), 'connected');
    assert.equal(getGoogleConnectionStatus({ ageMs: 61 * MIN, hasGoogleUser: true }), 'needs_signin');
    assert.equal(getGoogleConnectionStatus({ ageMs: Infinity, hasGoogleUser: true }), 'needs_signin');
  });

  test('no token: amber if this person signed in before, no dot if never', () => {
    assert.equal(getGoogleConnectionStatus({ ageMs: null, hasGoogleUser: true }), 'needs_signin');
    assert.equal(getGoogleConnectionStatus({ ageMs: null, hasGoogleUser: false }), 'none');
  });

  test('renewal happens on a tap, never on a background timer (browsers block that)', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync(new URL('../src/hooks/useGoogleAuth.js', import.meta.url), 'utf8');
    assert.match(hook, /addEventListener\('click', renewOnTap\)/);
    assert.match(hook, /__lastGoogleTokenRequestAt/);
    assert.doesNotMatch(hook, /setInterval\(renew/);
    assert.doesNotMatch(hook, /setTimeout\(renew/);
  });
});
