export const INVITE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const INVITE_CODE_LENGTH = 8;
const INVITE_REJECTION_LIMIT = 252; // 252 = 7 * 36 (largest multiple of 36 < 256)

export function generateInviteCode(fillRandomBytes = (buf) => crypto.getRandomValues(buf)) {
  const chars = [];
  const buf = new Uint8Array(16);

  while (chars.length < INVITE_CODE_LENGTH) {
    fillRandomBytes(buf);
    for (let i = 0; i < buf.length && chars.length < INVITE_CODE_LENGTH; i += 1) {
      const byte = buf[i];
      if (byte < INVITE_REJECTION_LIMIT) {
        chars.push(INVITE_CODE_CHARS[byte % INVITE_CODE_CHARS.length]);
      }
    }
  }

  return `ADPC-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

export function getUserAccessDocId(googleUser) {
  return googleUser?.firebaseUid || '';
}

export function buildUserAccessRecord(googleUser, sourceInviteId) {
  const uid = getUserAccessDocId(googleUser);
  const email = googleUser?.email ? googleUser.email.toLowerCase() : '';

  return {
    uid,
    email,
    sourceInviteId,
    createdAt: new Date()
  };
}
