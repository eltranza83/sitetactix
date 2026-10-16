import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDriveFileId, getCachedDriveBlob, setCachedDriveBlob } from '../src/hooks/useAuthenticatedDriveImage.js';

test('extractDriveFileId correctly extracts Drive file IDs from various Google Drive URL formats', () => {
  // Format 1: /file/d/FILE_ID/view
  const url1 = 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing';
  assert.equal(extractDriveFileId(url1), '1A2B3C4D5E6F7G8H9I0J');

  // Format 2: ?id=FILE_ID
  const url2 = 'https://drive.google.com/thumbnail?id=1X9Y8Z7W6V5U4T3S2R1Q&sz=w400';
  assert.equal(extractDriveFileId(url2), '1X9Y8Z7W6V5U4T3S2R1Q');

  // Format 3: /uc?id=FILE_ID
  const url3 = 'https://drive.google.com/uc?id=1234567890abcdef_XYZ';
  assert.equal(extractDriveFileId(url3), '1234567890abcdef_XYZ');

  // Invalid or null URLs
  assert.equal(extractDriveFileId(null), null);
  assert.equal(extractDriveFileId(''), null);
  assert.equal(extractDriveFileId('data:image/jpeg;base64,...'), null);
  assert.equal(extractDriveFileId('blob:http://localhost:5173/abc'), null);
});

test('rawBlobCache properly caches and retrieves raw Blob instances', () => {
  const dummyBlob = { size: 1024, type: 'image/jpeg' };
  setCachedDriveBlob('test_file_123', dummyBlob);

  assert.equal(getCachedDriveBlob('test_file_123'), dummyBlob);
  assert.equal(getCachedDriveBlob('non_existent_file'), undefined);
});

test('the photo cache drops the least recently used photos once it passes 40 MB', () => {
  const tenMb = (id) => ({ size: 10 * 1024 * 1024, type: 'image/jpeg', id });
  ['lru_a', 'lru_b', 'lru_c', 'lru_d'].forEach(id => setCachedDriveBlob(id, tenMb(id)));
  // Opening photo A again makes it the most recent, so B is now the oldest
  assert.ok(getCachedDriveBlob('lru_a'));
  setCachedDriveBlob('lru_e', tenMb('lru_e'));

  assert.equal(getCachedDriveBlob('lru_b'), undefined);
  ['lru_a', 'lru_c', 'lru_d', 'lru_e'].forEach(id => assert.ok(getCachedDriveBlob(id), id));
});
