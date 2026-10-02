import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildJarvisFileCards } from '../src/services/jarvis/fileCards.js';
import { list_folder_files } from '../src/services/jarvis/tools/drive.js';
import { add_reminder } from '../src/services/jarvis/tools/reminders.js';

describe('v1.4.2 New Jarvis file opening', () => {
  test('card comes only from the open_file tool Jarvis ran', () => {
    const cards = buildJarvisFileCards([
      { name: 'list_folder_files', ok: true, result: { ok: true, folderName: 'Floor and Decor', files: [{ id: 'f1' }] } },
      {
        name: 'open_file',
        ok: true,
        result: { ok: true, fileId: 'pdf_dolomite', fileName: 'Lot 3 - Purchase of Mar Nova Dolomite - material.pdf', folderName: 'Floor and Decor' }
      }
    ]);

    assert.deepEqual(cards, [{
      id: 'pdf_dolomite',
      name: 'Lot 3 - Purchase of Mar Nova Dolomite - material.pdf',
      folderName: 'Floor and Decor',
      webViewLink: 'https://drive.google.com/file/d/pdf_dolomite/view'
    }]);
  });

  test('open_receipt results use driveFileId and vendor', () => {
    const cards = buildJarvisFileCards([
      { name: 'open_receipt', ok: true, result: { ok: true, driveFileId: 'rcpt_1', fileName: 'Floor & Decor - $1,280.00.pdf', vendor: 'Floor & Decor' } }
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'rcpt_1');
    assert.equal(cards[0].folderName, 'Floor & Decor');
  });

  test('no card when no open tool ran, or the open failed, or it repeats', () => {
    assert.deepEqual(buildJarvisFileCards([]), []);
    assert.deepEqual(buildJarvisFileCards(undefined), []);
    assert.deepEqual(buildJarvisFileCards([
      { name: 'open_file', ok: false, result: { ok: false, error: 'unauthorized_file' } },
      { name: 'get_contractor_balance', ok: true, result: { ok: true } }
    ]), []);
    assert.equal(buildJarvisFileCards([
      { name: 'open_file', ok: true, result: { fileId: 'a', fileName: 'A.pdf' } },
      { name: 'open_file', ok: true, result: { fileId: 'a', fileName: 'A.pdf' } }
    ]).length, 1);
  });

  test('assistant skips Classic file guessing when the New engine is on', () => {
    const src = readFileSync(new URL('../src/components/GlobalAIAssistant.jsx', import.meta.url), 'utf8');
    assert.match(src, /if \(!isNewEngine && !isManualNoReceiptIntent\) \{\s*targetFile = findReferencedDriveFile/);
    assert.match(src, /const attachedDocs = isNewEngine \? buildJarvisFileCards\(answerPayload\?\.executedTools\) : \[\];/);
    assert.match(src, /if \(!isNewEngine && targetFile && targetFile\.id/);
    assert.match(src, /if \(!isNewEngine && viewFiles\.length === 0 && \(isViewIntent/);
  });
});

describe('v1.4.2 expired Google sign-in', () => {
  test('folder listing says the sign-in expired on a 401', async () => {
    const res = await list_folder_files(
      { folder: 'Home Depot' },
      {
        driveTree: null,
        googleToken: 'expired_token',
        projectFolderId: 'lot3_root',
        fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) })
      }
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, 'needs_auth');
    assert.equal(res.message, 'Your Google sign-in expired. Please sign in again.');
  });

  test('folder listing still says Drive is unreachable on other errors', async () => {
    const res = await list_folder_files(
      { folder: 'Home Depot' },
      {
        driveTree: null,
        googleToken: 'token',
        projectFolderId: 'lot3_root',
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
      }
    );
    assert.equal(res.error, 'drive_unavailable');
  });

  test('reminders: 401 = sign-in expired, 403 = missing Calendar permission', async () => {
    const originalFetch = globalThis.fetch;
    const store = {};
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    try {
      globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
      const expired = await add_reminder({ text: 'Call the plumber', when: '2026-10-03T14:00:00' }, { googleToken: 'expired', uid: 'u1' });
      assert.equal(expired.ok, false);
      assert.equal(expired.message, 'Your Google sign-in expired. Please sign in again.');

      globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' });
      const noScope = await add_reminder({ text: 'Call the plumber', when: '2026-10-03T14:00:00' }, { googleToken: 'token', uid: 'u2' });
      assert.equal(noScope.ok, false);
      assert.match(noScope.message, /Calendar permission/);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.localStorage = originalStorage;
    }
  });
});
