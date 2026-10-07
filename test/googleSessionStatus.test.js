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

  test('renews quietly from 50 minutes on (and when there is no token)', () => {
    assert.equal(GOOGLE_TOKEN_RENEW_AFTER_MS, 50 * MIN);
    assert.equal(shouldRenewGoogleToken(10 * MIN), false);
    assert.equal(shouldRenewGoogleToken(50 * MIN), true);
    assert.equal(shouldRenewGoogleToken(Infinity), true);
    assert.equal(shouldRenewGoogleToken(null), true);
  });

  test('green while fresh, amber once an hour old or when renewal failed late', () => {
    assert.equal(GOOGLE_TOKEN_LIFETIME_MS, 60 * MIN);
    assert.equal(getGoogleConnectionStatus({ ageMs: 5 * MIN, hasGoogleUser: true, renewFailed: false }), 'connected');
    assert.equal(getGoogleConnectionStatus({ ageMs: 55 * MIN, hasGoogleUser: true, renewFailed: false }), 'connected');
    assert.equal(getGoogleConnectionStatus({ ageMs: 55 * MIN, hasGoogleUser: true, renewFailed: true }), 'needs_signin');
    assert.equal(getGoogleConnectionStatus({ ageMs: 61 * MIN, hasGoogleUser: true, renewFailed: false }), 'needs_signin');
    assert.equal(getGoogleConnectionStatus({ ageMs: Infinity, hasGoogleUser: true, renewFailed: false }), 'needs_signin');
  });

  test('a renewal failure on a still-fresh token does not turn the dot amber', () => {
    assert.equal(getGoogleConnectionStatus({ ageMs: 10 * MIN, hasGoogleUser: true, renewFailed: true }), 'connected');
  });

  test('no token: amber if this person signed in before, no dot if never', () => {
    assert.equal(getGoogleConnectionStatus({ ageMs: null, hasGoogleUser: true, renewFailed: false }), 'needs_signin');
    assert.equal(getGoogleConnectionStatus({ ageMs: null, hasGoogleUser: false, renewFailed: false }), 'none');
  });
});
