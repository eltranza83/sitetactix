import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHistoryFileId
} from '../src/services/invoiceSyncState.js';

test('getHistoryFileId removes split suffix for shared PDFs', () => {
  assert.equal(getHistoryFileId({ id: 'file-123_split_0' }), 'file-123');
  assert.equal(getHistoryFileId({ id: 'file-456' }), 'file-456');
  assert.equal(getHistoryFileId(null), '');
});
