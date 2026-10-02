import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildJarvisFileCards } from '../src/services/jarvis/fileCards.js';
import { list_folder_files } from '../src/services/jarvis/tools/drive.js';

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
});

describe('v1.4.3 reminders removed from Jarvis', () => {
  test('no reminder tools are offered or registered', async () => {
    const { JARVIS_TOOL_DECLARATIONS } = await import('../api/_lib/jarvis-tools-definitions.js');
    const { JARVIS_TOOL_REGISTRY } = await import('../src/services/jarvis/tools/index.js');
    const names = [...JARVIS_TOOL_DECLARATIONS.map(t => t.name), ...Object.keys(JARVIS_TOOL_REGISTRY)];
    assert.equal(names.some(n => /reminder/i.test(n)), false);
  });

  test('sign-in no longer asks for Google Calendar permission', () => {
    const src = readFileSync(new URL('../src/hooks/useGoogleAuth.js', import.meta.url), 'utf8');
    assert.equal(src.includes('auth/calendar'), false);
  });
});

describe('v1.4.4 folder listings show the purchase date', () => {
  const folderSearch = (filesResponse) => async (url) => {
    const u = decodeURIComponent(url);
    if (u.includes("name = 'Floor and Decor'")) {
      return { ok: true, json: async () => ({ files: [{ id: 'fld_fd', name: 'Floor and Decor', parents: ['lot3_root'] }] }) };
    }
    if (u.includes("'fld_fd' in parents")) {
      return { ok: true, json: async () => ({ files: filesResponse }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  test('purchase date comes from the receipt details saved on the Drive file', async () => {
    const res = await list_folder_files({ folder: 'Floor and Decor' }, {
      googleToken: 't', projectFolderId: 'lot3_root',
      fetchImpl: folderSearch([{
        id: 'pdf_dolomite',
        name: 'Lot 3 - Purchase of Mar Nova Dolomite - material.pdf',
        createdTime: '2026-08-28T15:53:00Z',
        description: JSON.stringify({ date: '2026-02-01', amount: 161.56, vendor: 'Floor and Decor', description: 'Mar Nova Dolomite tile' })
      }])
    });
    assert.equal(res.ok, true);
    assert.equal(res.files[0].purchaseDate, '2026-02-01');
    assert.equal(res.files[0].savedToDrive, '2026-08-28');
    assert.equal(res.files[0].amount, 161.56);
  });

  test('falls back to the spreadsheet row linked to the same file', async () => {
    const ledgerSource = {
      getTransactionByDriveFileId: (id) => (id === 'pdf_manual' ? { date: '2026-03-15', amount: 89.1, vendor: 'Floor and Decor' } : null)
    };
    const res = await list_folder_files({ folder: 'Floor and Decor' }, {
      googleToken: 't', projectFolderId: 'lot3_root', ledgerSource,
      fetchImpl: folderSearch([
        { id: 'pdf_manual', name: 'grout.pdf', createdTime: '2026-09-01T10:00:00Z' },
        { id: 'pdf_unknown', name: 'photo.jpg', createdTime: '2026-09-02T10:00:00Z' }
      ])
    });
    assert.equal(res.files[0].purchaseDate, '2026-03-15');
    assert.equal(res.files[0].amount, 89.1);
    assert.equal(res.files[1].purchaseDate, null);
    assert.equal(res.files[1].savedToDrive, '2026-09-02');
  });
});
