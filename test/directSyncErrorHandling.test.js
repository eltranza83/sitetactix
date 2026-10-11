import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncUploadedInvoicesDirectly } from '../src/services/directSyncService.js';
import { partitionDraftsBySyncResult } from '../src/services/invoiceSyncState.js';

describe('Direct Sync Robustness & Failure Isolation Suite', () => {
  const originalFetch = globalThis.fetch;
  let movedFiles = [];
  let taggedFiles = [];
  let sheetWrites = [];


  beforeEach(() => {
    movedFiles = [];
    taggedFiles = [];
    sheetWrites = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Pure Function: partitionDraftsBySyncResult', () => {
    it('accurately partitions drafts by driveFileId matching failures', () => {
      const drafts = [
        { id: 'draft_1', driveFileId: 'file_aaa' },
        { id: 'draft_2', driveFileId: 'file_bbb' },
        { id: 'draft_3', driveFileId: 'file_ccc' }
      ];
      const failedItems = [
        { fileId: 'file_bbb', reason: 'Phase header not found' }
      ];

      const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult(drafts, failedItems);

      assert.equal(successfulDrafts.length, 2);
      assert.deepEqual(successfulDrafts.map(d => d.id), ['draft_1', 'draft_3']);

      assert.equal(failedDrafts.length, 1);
      assert.equal(failedDrafts[0].draft.id, 'draft_2');
      assert.equal(failedDrafts[0].reason, 'Phase header not found');
    });

    it('returns all drafts as successful when failedItems is empty', () => {
      const drafts = [{ id: 'd1', driveFileId: 'f1' }];
      const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult(drafts, []);
      assert.equal(successfulDrafts.length, 1);
      assert.equal(failedDrafts.length, 0);
    });

    it('correctly handles Sync All with mixed upload and sheet failures without losing drafts', () => {
      // Simulation of activeProjectDrafts in Sync All:
      // Draft 1: Upload succeeded, spreadsheet succeeded -> should be removed
      // Draft 2: Upload succeeded, spreadsheet failed -> should be kept with reason
      // Draft 3: Upload failed (no driveFileId) -> should NEVER enter partitionDraftsBySyncResult and should be kept
      const activeProjectDrafts = [
        { id: 'd1_success', driveFileId: 'file_1' },
        { id: 'd2_sheet_fail', driveFileId: 'file_2' },
        { id: 'd3_upload_fail' } // Upload to Drive threw/failed
      ];

      // Sync All only adds drafts with real driveFileIds to uploadedDrafts
      const uploadedDrafts = activeProjectDrafts.filter(d => Boolean(d.driveFileId));
      const syncResultFailed = [{ fileId: 'file_2', reason: 'Phase header not found' }];

      const { successfulDrafts, failedDrafts } = partitionDraftsBySyncResult(uploadedDrafts, syncResultFailed);

      assert.equal(successfulDrafts.length, 1);
      assert.equal(successfulDrafts[0].id, 'd1_success');

      assert.equal(failedDrafts.length, 1);
      assert.equal(failedDrafts[0].draft.id, 'd2_sheet_fail');
      assert.equal(failedDrafts[0].reason, 'Phase header not found');

      // The un-uploaded draft d3_upload_fail remains safely untouched on device
      const draftsToRemove = successfulDrafts.map(d => d.id);
      assert.ok(!draftsToRemove.includes('d3_upload_fail'), 'Draft with failed upload must NOT be removed from device');
      assert.ok(!draftsToRemove.includes('d2_sheet_fail'), 'Draft with failed sheet sync must NOT be removed from device');
    });
  });


  describe('Batch Execution & Error Isolation', () => {
    function setupBatchMockFetch({
      files = [],
      failOnAppendForFileId = null,
      authErrorOnWrite = false,
      rateLimitErrorOnWrite = false,
      failOnTagForFileId = null,
      failOnMoveStatus = null
    } = {}) {
      globalThis.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const urlStr = decodeURIComponent(rawUrl);
        const method = options.method || 'GET';

        // 1. Google Drive API files search (finding folders/spreadsheet)
        if (rawUrl.includes('googleapis.com/drive/v3/files') && method === 'GET') {
          if (urlStr.includes("name='App Folders'")) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'app_folders_123', name: 'App Folders' }] }) };
          }
          if (urlStr.includes("name='Invoice Uploads'")) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'uploads_folder_123', name: 'Invoice Uploads' }] }) };
          }
          if (urlStr.includes("mimeType='application/vnd.google-apps.spreadsheet'")) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'spreadsheet_123', name: 'Lot 3 – SiteTactix' }] }) };
          }
          if (urlStr.includes("'uploads_folder_123' in parents")) {
            return { ok: true, status: 200, json: async () => ({ files }) };
          }
          if (urlStr.includes("name='Vendors / Stores'")) {
            return { ok: true, status: 200, json: async () => ({ files: [{ id: 'vendors_stores_123', name: 'Vendors / Stores' }] }) };
          }
          // Vendor subfolder lookup
          return { ok: true, status: 200, json: async () => ({ files: [{ id: 'vendor_folder_777', name: 'Vendor Folder' }] }) };
        }

        // 2. Drive file tagging (PATCH)
        if (rawUrl.includes('googleapis.com/drive/v3/files/') && method === 'PATCH' && !rawUrl.includes('addParents')) {
          const match = rawUrl.match(/\/files\/([a-zA-Z0-9_-]+)/);
          const fileId = match ? match[1] : 'unknown';
          if (failOnTagForFileId === fileId) {
            return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'Tagging failed' };
          }
          taggedFiles.push(fileId);
          return { ok: true, status: 200, json: async () => ({ id: fileId, appProperties: { sheetRowWritten: 'true' } }) };
        }

        // 3. Drive move file (PATCH with addParents)
        if (rawUrl.includes('googleapis.com/drive/v3/files/') && method === 'PATCH' && rawUrl.includes('addParents')) {
          const match = rawUrl.match(/\/files\/([a-zA-Z0-9_-]+)/);
          const fileId = match ? match[1] : 'unknown';
          if (failOnMoveStatus) {
            return { ok: false, status: failOnMoveStatus, statusText: 'Move Failed', text: async () => `Move error ${failOnMoveStatus}` };
          }
          movedFiles.push(fileId);
          return { ok: true, status: 200, json: async () => ({ id: fileId }) };
        }

        // 4. Google Sheets metadata: a template Sheet
        if (rawUrl.includes('sheets.googleapis.com/v4/spreadsheets/spreadsheet_123?')) {
          const sheets = ['Dashboard', 'Contracts', 'House Exterior & Yard', 'Project Info', 'Transactions']
            .map((title, i) => ({ properties: { sheetId: 100 + i, title } }));
          return { ok: true, status: 200, json: async () => ({ sheets }) };
        }

        // 5. Phase-section growth check after the sync (nothing to grow here)
        if (rawUrl.includes('sheets.googleapis.com/v4/spreadsheets/spreadsheet_123/values:batchGet')) {
          return { ok: true, status: 200, json: async () => ({ valueRanges: [] }) };
        }

        if (rawUrl.includes('sheets.googleapis.com/v4/spreadsheets/spreadsheet_123/values/')) {
          // 6. Transactions row append
          if (urlStr.includes(':append') && method === 'POST') {
            if (authErrorOnWrite) {
              return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'Invalid credentials' };
            }
            if (rateLimitErrorOnWrite) {
              return { ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'Rate limit exceeded' };
            }
            const body = JSON.parse(options.body);
            const receiptId = body.values[0][9];
            if (failOnAppendForFileId && receiptId === failOnAppendForFileId) {
              return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'Bad row' };
            }
            sheetWrites.push(body);
            return { ok: true, status: 200, json: async () => ({ updates: { updatedRows: 1 } }) };
          }
          // 7. Receipt IDs already in Transactions (none)
          return { ok: true, status: 200, json: async () => ({ values: [] }) };
        }

        return { ok: true, status: 200, json: async () => ({}) };
      };
    }

    const receipt = (id, extra = {}) => ({
      id,
      name: `${id}.pdf`,
      mimeType: 'application/pdf',
      webViewLink: `https://drive.google.com/${id}`,
      description: JSON.stringify({
        tradeCategory: 'House_Exterior_&_Yard',
        tradePhase: 'Landscaping & Irrigation',
        vendor: 'Good Vendor',
        amount: 100,
        ...extra
      })
    });

    it('isolates a bad file between two good files without stopping the run', async () => {
      const files = [
        receipt('file_good_1', { vendor: 'Good Vendor A' }),
        receipt('file_bad_2', { vendor: 'Bad Vendor B' }),
        receipt('file_good_3', { vendor: 'Good Vendor C' })
      ];

      setupBatchMockFetch({ files, failOnAppendForFileId: 'file_bad_2' });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.ok, true);
      assert.equal(result.processedCount, 2, 'Both good files must be processed');
      assert.deepEqual(movedFiles, ['file_good_1', 'file_good_3'], 'Only good files should be moved out of Uploads');

      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].fileId, 'file_bad_2');
      assert.equal(result.failed[0].fileName, 'file_bad_2.pdf');
      assert.ok(result.failed[0].reason.includes('Failed to add invoice row to Transactions'));
    });

    it('a receipt with no trade phase fails on its own and stays in Uploads', async () => {
      const files = [receipt('file_good_1'), receipt('file_no_phase', { tradePhase: '' })];

      setupBatchMockFetch({ files });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.processedCount, 1);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].fileId, 'file_no_phase');
      assert.ok(result.failed[0].reason.includes('missing trade category or phase'));
      assert.deepEqual(movedFiles, ['file_good_1']);
      assert.equal(sheetWrites.length, 1);
    });

    it('aborts the entire run immediately on fatal 401 auth error without recording per-file failures', async () => {
      const files = [
        { ...receipt('file_1'), name: 'Invoice 401.pdf' }, // Tricky name that contains 401
        receipt('file_2')
      ];

      setupBatchMockFetch({ files, authErrorOnWrite: true });

      await assert.rejects(
        async () => {
          await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');
        },
        (err) => {
          assert.equal(err.status, 401);
          assert.ok(err.isFatalGoogleError);
          return true;
        }
      );

      assert.equal(movedFiles.length, 0, 'No files should be moved on fatal auth abort');
    });

    it('aborts the run with a "Google is busy" error on a rate limit', async () => {
      setupBatchMockFetch({ files: [receipt('file_1')], rateLimitErrorOnWrite: true });

      await assert.rejects(
        syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder'),
        (err) => {
          assert.equal(err.status, 429);
          assert.ok(err.isFatalGoogleError);
          return true;
        }
      );
      assert.equal(movedFiles.length, 0);
    });

    it('skips spreadsheet write for previously tagged file and only moves it', async () => {
      const files = [{ ...receipt('file_already_written', { amount: 500 }), appProperties: { sheetRowWritten: 'true' } }];

      setupBatchMockFetch({ files });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.ok, true);
      assert.equal(result.processedCount, 1);
      assert.equal(sheetWrites.length, 0, 'Must NOT write row to sheet again (duplicate avoidance)');
      assert.deepEqual(movedFiles, ['file_already_written'], 'Must complete the move to vendor folder');
    });

    it('records failure and leaves file in Uploads when tagging fails after write', async () => {
      setupBatchMockFetch({ files: [receipt('file_tag_fail', { amount: 500 })], failOnTagForFileId: 'file_tag_fail' });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.processedCount, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].fileId, 'file_tag_fail');
      assert.ok(result.failed[0].reason.includes('could not be tagged in Drive'));
      assert.equal(movedFiles.length, 0, 'File must NOT be moved if tagging fails');
    });

    it('aborts run when 401 error occurs while moving file and leaves file tagged sheetRowWritten', async () => {
      setupBatchMockFetch({ files: [receipt('file_move_401', { amount: 250 })], failOnMoveStatus: 401 });

      await assert.rejects(
        async () => {
          await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');
        },
        (err) => {
          assert.equal(err.status, 401);
          assert.ok(err.isFatalGoogleError);
          return true;
        }
      );

      // Transactions row was written and the file tagged before the move was attempted
      assert.equal(sheetWrites.length, 1, 'Transactions row was written');
      assert.deepEqual(taggedFiles, ['file_move_401'], 'File was tagged sheetRowWritten');
      assert.equal(movedFiles.length, 0, 'Move did not succeed');
    });
  });
});
