import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVITE_CODE_CHARS,
  buildUserAccessRecord,
  generateInviteCode,
  getUserAccessDocId
} from '../src/services/inviteAccess.js';

test('INVITE_CODE_CHARS contains all 36 uppercase alphanumeric characters including 7', () => {
  assert.equal(INVITE_CODE_CHARS.length, 36);
  assert.ok(INVITE_CODE_CHARS.includes('7'));
  assert.equal(new Set(INVITE_CODE_CHARS).size, 36);
});

test('generateInviteCode produces valid ADPC-XXXX-XXXX codes using unbiased rejection sampling', () => {
  const randomCode = generateInviteCode();
  assert.match(randomCode, /^ADPC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Bytes >= 252 must be rejected; remaining bytes map via byte % 36
  // 0->A, 1->B, 33->7, 35->9, 36->A, 37->B, 69->7, 71->9
  const scriptedBytes = [252, 253, 254, 255, 0, 1, 33, 35, 36, 37, 69, 71];
  let offset = 0;
  const deterministic = generateInviteCode((buf) => {
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = offset < scriptedBytes.length ? scriptedBytes[offset++] : 255;
    }
  });
  assert.equal(deterministic, 'ADPC-AB79-AB79');
});

test('getUserAccessDocId uses Firebase uid', () => {
  assert.equal(getUserAccessDocId({ firebaseUid: 'uid-123' }), 'uid-123');
  assert.equal(getUserAccessDocId({ email: 'user@example.com' }), '');
});

test('buildUserAccessRecord normalizes access metadata', () => {
  const record = buildUserAccessRecord({
    firebaseUid: 'uid-123',
    email: 'USER@EXAMPLE.COM'
  }, 'ADPC-TEST-0001');

  assert.equal(record.uid, 'uid-123');
  assert.equal(record.email, 'user@example.com');
  assert.equal(record.sourceInviteId, 'ADPC-TEST-0001');
  assert.ok(record.createdAt instanceof Date);
});
