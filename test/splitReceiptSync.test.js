// Split receipts through the REAL upload code (invoiceUpload.js + googleDrive.js) on a fake Drive:
// retries never duplicate a PDF, edits reach Drive, other lots get their own files and links.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDrive } from './fakeDrive.js';
import { syncInvoiceDocument } from '../src/services/invoiceUpload.js';
import {
  draftSyncFailure,
  foldersToSync,
  getDraftUploads,
  getHistoryFileId,
  partitionDraftsBySyncResult
} from '../src/services/invoiceSyncState.js';
import { syncUploadedInvoicesForFolders } from '../src/services/directSyncService.js';

const UPLOADS = 'App Folders/Invoice Uploads';
const projects = [
  { id: 'p99', name: 'Lot 99', folderId: 'lot99' },
  { id: 'p3', name: 'Lot 3', folderId: 'lot3' }
];
const selectedFolder = { id: 'lot99', name: 'Lot 99' };

function splitDraft(splits) {
  return {
    id: 'draft_1',
    metadata: {
      vendor: 'Home Depot',
      date: '2026-10-15',
      amount: splits.reduce((sum, s) => sum + s.amount, 0),
      costCategory: 'material',
      lotNumber: 'Lot 99',
      tradeCategory: 'Mechanicals_&_Utilities',
      tradePhase: 'Plumbing',
      splits: splits.map(s => ({
        tradeCategory: 'Mechanicals_&_Utilities',
        tradePhase: 'Plumbing',
        description: 'Fittings',
        ...s
      }))
    }
  };
}

async function sync(item) {
  const progress = [];
  try {
    const result = await syncInvoiceDocument({
      item,
      googleToken: 'token',
      selectedFolder,
      projects,
      onUploaded: uploads => progress.push(uploads)
    });
    return { result, progress };
  } catch (error) {
    return { error, progress };
  }
}

const uploadedDraft = (item, uploads) => ({ ...item, uploads });

describe('split receipt upload (real code, fake Drive)', () => {
  let drive;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    drive = createFakeDrive();
    globalThis.fetch = drive.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('each split goes to its own lot, with its own file, link and folder', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const { result, error } = await sync(item);
    assert.equal(error, undefined);

    assert.equal(drive.livePdfsIn(`lot99/${UPLOADS}`).length, 1);
    assert.equal(drive.livePdfsIn(`lot3/${UPLOADS}`).length, 1);
    assert.equal(result.uploads['0'].folderId, 'lot99');
    assert.equal(result.uploads['1'].folderId, 'lot3');
    assert.deepEqual(foldersToSync([uploadedDraft(item, result.uploads)]).sort(), ['lot3', 'lot99']);

    // History: every split opens its OWN PDF and is checked against its own lot
    const [first, second] = result.logs;
    assert.notEqual(first.link, second.link);
    assert.equal(getHistoryFileId(first), result.uploads['0'].fileId);
    assert.equal(getHistoryFileId(second), result.uploads['1'].fileId);
    assert.equal(first.folderId, 'lot99');
    assert.equal(second.folderId, 'lot3');
    assert.equal(first.receiptId, 'draft_1_split_0');
    assert.equal(second.receiptId, 'draft_1_split_1');
  });

  test('split 2 fails mid-upload: split 1 is remembered, the half-made file is removed, retry adds no duplicate', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    drive.failMediaUpload(2);
    const firstTry = await sync(item);

    assert.ok(firstTry.error, 'the first try should fail on split 2');
    const remembered = firstTry.progress.at(-1);
    assert.deepEqual(Object.keys(remembered), ['0']);
    // The empty split-2 file carried the receipt details, so it must not stay where the sync would log it
    assert.equal(drive.livePdfsIn(`lot3/${UPLOADS}`).length, 0);

    const retry = await sync({ ...item, uploads: remembered });
    assert.equal(retry.error, undefined);
    assert.equal(drive.livePdfsIn(`lot99/${UPLOADS}`).length, 1, 'split 1 must not be uploaded twice');
    assert.equal(drive.livePdfsIn(`lot3/${UPLOADS}`).length, 1);
    assert.equal(retry.result.uploads['0'].fileId, remembered['0'].fileId);
  });

  test('a retry of an unchanged draft uploads nothing again', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const { result } = await sync(item);
    const uploadsBefore = drive.mediaUploads();

    const retry = await sync({ ...item, uploads: result.uploads });
    assert.equal(retry.error, undefined);
    assert.equal(drive.mediaUploads(), uploadsBefore);
    assert.deepEqual(retry.result.uploads, result.uploads);
  });

  test('an edit after upload refreshes the same Drive file (the Sheet gets the new amount)', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const { result } = await sync(item);

    const edited = splitDraft([{ amount: 90, lotNumber: 'Lot 99' }, { amount: 60, lotNumber: 'Lot 3' }]);
    const retry = await sync({ ...edited, uploads: result.uploads });

    assert.equal(retry.result.uploads['0'].fileId, result.uploads['0'].fileId);
    assert.equal(drive.livePdfsIn(`lot99/${UPLOADS}`).length, 1);
    const file = drive.files.get(result.uploads['0'].fileId);
    assert.equal(JSON.parse(file.description).amount, 90);
    assert.equal(JSON.parse(drive.files.get(result.uploads['1'].fileId).description).amount, 60);
  });

  test('a split moved to another lot moves its file there', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 99' }]);
    const { result } = await sync(item);

    const edited = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const retry = await sync({ ...edited, uploads: result.uploads });

    assert.equal(retry.result.uploads['1'].fileId, result.uploads['1'].fileId);
    assert.equal(retry.result.uploads['1'].folderId, 'lot3');
    assert.equal(drive.livePdfsIn(`lot99/${UPLOADS}`).length, 1);
    assert.equal(drive.livePdfsIn(`lot3/${UPLOADS}`).length, 1);
  });

  test('a file already written to the Sheet is never changed again', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const { result } = await sync(item);
    drive.files.get(result.uploads['0'].fileId).appProperties.sheetRowWritten = 'true';

    const edited = splitDraft([{ amount: 90, lotNumber: 'Lot 99' }, { amount: 60, lotNumber: 'Lot 3' }]);
    await sync({ ...edited, uploads: result.uploads });

    assert.equal(JSON.parse(drive.files.get(result.uploads['0'].fileId).description).amount, 100);
    assert.equal(JSON.parse(drive.files.get(result.uploads['1'].fileId).description).amount, 60);
  });

  test('a removed split has its waiting file removed', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 3' }]);
    const { result } = await sync(item);

    const edited = splitDraft([{ amount: 150, lotNumber: 'Lot 99' }]);
    const retry = await sync({ ...edited, uploads: result.uploads });

    assert.deepEqual(Object.keys(retry.result.uploads), ['0']);
    assert.equal(drive.files.get(result.uploads['1'].fileId).trashed, true);
    assert.equal(drive.livePdfsIn(`lot3/${UPLOADS}`).length, 0);
  });

  test('a split for an unknown lot stops before anything is uploaded', async () => {
    const item = splitDraft([{ amount: 100, lotNumber: 'Lot 99' }, { amount: 50, lotNumber: 'Lot 404' }]);
    const { error } = await sync(item);
    assert.match(error.message, /Lot 404/);
    assert.equal(drive.mediaUploads(), 0);
  });

  test('a one-file receipt that was uploaded before is reused, not uploaded again', async () => {
    const item = {
      id: 'draft_2',
      metadata: {
        vendor: 'Lowes', date: '2026-10-15', amount: 25, costCategory: 'material', lotNumber: 'Lot 99',
        tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing'
      }
    };
    const { result } = await sync(item);
    assert.equal(result.logs[0].id, result.uploads.main.fileId);
    const uploadsBefore = drive.mediaUploads();

    const retry = await sync({ ...item, uploads: result.uploads });
    assert.equal(drive.mediaUploads(), uploadsBefore);
    assert.equal(drive.livePdfsIn(`lot99/${UPLOADS}`).length, 1);
    assert.equal(retry.result.uploads.main.fileId, result.uploads.main.fileId);
  });
});

describe('which drafts really synced', () => {
  const draft = {
    id: 'd1',
    uploads: {
      0: { fileId: 'a', folderId: 'lot99' },
      1: { fileId: 'b', folderId: 'lot3' }
    }
  };

  test('a draft fails when ANY of its splits failed, not just the first', () => {
    assert.equal(draftSyncFailure(draft, [{ fileId: 'b', reason: 'Row write failed' }]), 'Row write failed');
    const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult([draft], [{ fileId: 'b', reason: 'x' }]);
    assert.equal(successfulDrafts.length, 0);
    assert.equal(failedDrafts.length, 1);
  });

  test('a draft fails when the other lot\'s Sheet could not sync at all', () => {
    assert.equal(draftSyncFailure(draft, [], { lot3: 'Sheet not found' }), 'Sheet not found');
  });

  test('a draft succeeds only when every split made it', () => {
    assert.equal(draftSyncFailure(draft, [{ fileId: 'other', reason: 'x' }], { lot55: 'y' }), null);
  });

  test('drafts saved before this release (one driveFileId) still work', () => {
    const legacySplit = {
      id: 'd2',
      driveFileId: 'old',
      driveFileLink: 'link',
      metadata: { splits: [{ amount: 0 }, { amount: 10 }] }
    };
    assert.deepEqual(getDraftUploads(legacySplit), { 1: { fileId: 'old', link: 'link', folderId: null } });
    assert.deepEqual(getDraftUploads({ id: 'd3', driveFileId: 'x', metadata: {} }), { main: { fileId: 'x', link: null, folderId: null } });
    assert.deepEqual(getDraftUploads({ id: 'd4', metadata: {} }), {});
  });
});

describe('syncing every lot a receipt went to', () => {
  test('each lot syncs into its own Sheet; one failing lot does not stop the others', async () => {
    const seen = [];
    const result = await syncUploadedInvoicesForFolders('token', [
      { folderId: 'lot99', spreadsheetId: 'sheet99' },
      { folderId: 'lot3', spreadsheetId: null },
      { folderId: 'lot55', spreadsheetId: 'sheet55' }
    ], async (_token, folderId, spreadsheetId) => {
      seen.push([folderId, spreadsheetId]);
      if (folderId === 'lot3') throw new Error('Could not find Google Spreadsheet in the selected project folder.');
      return { spreadsheetId, processedCount: 1, failed: folderId === 'lot55' ? [{ fileId: 'z', reason: 'r' }] : [] };
    });

    assert.deepEqual(seen, [['lot99', 'sheet99'], ['lot3', null], ['lot55', 'sheet55']]);
    assert.equal(result.processedCount, 2);
    assert.deepEqual(result.spreadsheetByFolder, { lot99: 'sheet99', lot55: 'sheet55' });
    assert.match(result.folderErrors.lot3, /Could not find/);
    assert.deepEqual(result.failed, [{ fileId: 'z', reason: 'r' }]);
  });

  test('a sign-in problem stops the whole sync so the user can reconnect', async () => {
    const expired = Object.assign(new Error('Google Drive session expired.'), { status: 401 });
    await assert.rejects(
      syncUploadedInvoicesForFolders('token', [{ folderId: 'lot99' }, { folderId: 'lot3' }], async () => { throw expired; }),
      /session expired/
    );
  });
});
