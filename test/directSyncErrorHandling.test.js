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
  });

  describe('Batch Execution & Error Isolation', () => {
    function setupBatchMockFetch({
      files = [],
      failOnRowWriteForFileId = null,
      failOnTagForFileId = null,
      authErrorOnWrite = false,
      rateLimitErrorOnWrite = false
    } = {}) {
      globalThis.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const urlStr = decodeURIComponent(rawUrl);
        const method = options.method || 'GET';

        // 1. Google Drive API files search (finding folders/spreadsheet)
        if (rawUrl.includes('googleapis.com/drive/v3/files') && method === 'GET') {
          if (urlStr.includes("name='App Folders'")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'app_folders_123', name: 'App Folders' }] })
            };
          }
          if (urlStr.includes("name='Invoice Uploads'")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'uploads_folder_123', name: 'Invoice Uploads' }] })
            };
          }
          if (urlStr.includes("name='Processed Invoices'")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'processed_folder_123', name: 'Processed Invoices' }] })
            };
          }
          if (urlStr.includes("mimeType='application/vnd.google-apps.spreadsheet'")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'spreadsheet_123', name: 'JobScan_Expense_Log' }] })
            };
          }
          if (urlStr.includes("'uploads_folder_123' in parents")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files })
            };
          }
          if (urlStr.includes("name='Vendors / Stores'")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ files: [{ id: 'vendors_stores_123', name: 'Vendors / Stores' }] })
            };
          }
          // Vendor subfolder lookup
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: 'vendor_folder_777', name: 'Vendor Folder' }] })
          };
        }

        // 2. Drive file tagging (PATCH)
        if (rawUrl.includes('googleapis.com/drive/v3/files/') && method === 'PATCH' && !rawUrl.includes('addParents')) {
          const match = rawUrl.match(/\/files\/([a-zA-Z0-9_-]+)/);
          const fileId = match ? match[1] : 'unknown';

          if (failOnTagForFileId === fileId) {
            return {
              ok: false,
              status: 500,
              statusText: 'Internal Error',
              text: async () => 'Tagging failed'
            };
          }

          taggedFiles.push(fileId);
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: fileId, appProperties: { sheetRowWritten: 'true' } })
          };
        }

        // 3. Drive move file (PATCH with addParents)
        if (rawUrl.includes('googleapis.com/drive/v3/files/') && method === 'PATCH' && rawUrl.includes('addParents')) {
          const match = rawUrl.match(/\/files\/([a-zA-Z0-9_-]+)/);
          const fileId = match ? match[1] : 'unknown';
          movedFiles.push(fileId);
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: fileId })
          };
        }

        // 4. Google Sheets Metadata
        if (rawUrl.includes('sheets.googleapis.com/v4/spreadsheets/spreadsheet_123?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sheets: [{
                properties: {
                  sheetId: 101,
                  title: 'Exterior'
                }
              }]
            })
          };
        }

        // 5. Google Sheets Range fetch
        if (rawUrl.includes('sheets.googleapis.com/v4/spreadsheets/spreadsheet_123/values/')) {
          if (method === 'GET') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                values: [
                  ['EXTERIOR'],
                  ['Task Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans'],
                  ['→ Landscaping & Irrigation'],
                  ['', '', '', '', '', ''] // Has available slot at row 4
                ]
              })
            };
          }

          // 6. Values PUT (row update)
          if (method === 'PUT') {
            if (authErrorOnWrite) {
              return {
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: async () => 'Invalid credentials'
              };
            }
            if (rateLimitErrorOnWrite) {
              return {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                text: async () => 'Rate limit exceeded'
              };
            }

            sheetWrites.push(options.body);
            return {
              ok: true,
              status: 200,
              json: async () => ({ updatedRows: 1 })
            };
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({})
        };
      };
    }

    it('isolates a bad file between two good files without stopping the run', async () => {
      const files = [
        {
          id: 'file_good_1',
          name: 'Good_1.pdf',
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_good_1',
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Landscaping & Irrigation',
            vendor: 'Good Vendor A',
            amount: 100
          })
        },
        {
          id: 'file_bad_2',
          name: 'Bad_2.pdf',
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_bad_2',
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Nonexistent Phase Header XYZ',
            vendor: 'Bad Vendor B',
            amount: 200
          })
        },
        {
          id: 'file_good_3',
          name: 'Good_3.pdf',
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_good_3',
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Landscaping & Irrigation',
            vendor: 'Good Vendor C',
            amount: 300
          })
        }
      ];

      setupBatchMockFetch({ files });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.ok, true);
      assert.equal(result.processedCount, 2, 'Both good files must be processed');
      assert.deepEqual(movedFiles, ['file_good_1', 'file_good_3'], 'Only good files should be moved out of Uploads');

      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].fileId, 'file_bad_2');
      assert.equal(result.failed[0].fileName, 'Bad_2.pdf');
      assert.ok(result.failed[0].reason.includes('Nonexistent Phase Header XYZ'));
    });

    it('aborts the entire run immediately on fatal 401 auth error without recording per-file failures', async () => {
      const files = [
        {
          id: 'file_1',
          name: 'Invoice 401.pdf', // Tricky name that contains 401
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_1',
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Landscaping & Irrigation',
            vendor: 'Vendor 1',
            amount: 100
          })
        },
        {
          id: 'file_2',
          name: 'File_2.pdf',
          mimeType: 'application/pdf',
          description: JSON.stringify({ tradeCategory: 'Exterior', tradePhase: 'Landscaping & Irrigation' })
        }
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

    it('skips spreadsheet write for previously tagged file and only moves it', async () => {
      const files = [
        {
          id: 'file_already_written',
          name: 'Already_Written.pdf',
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_already_written',
          appProperties: { sheetRowWritten: 'true' }, // Already tagged in previous run
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Landscaping & Irrigation',
            vendor: 'Vendor Retry',
            amount: 500
          })
        }
      ];

      setupBatchMockFetch({ files });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.ok, true);
      assert.equal(result.processedCount, 1);
      assert.equal(sheetWrites.length, 0, 'Must NOT write row to sheet again (duplicate avoidance)');
      assert.deepEqual(movedFiles, ['file_already_written'], 'Must complete the move to vendor folder');
    });

    it('records failure and leaves file in Uploads when tagging fails after write', async () => {
      const files = [
        {
          id: 'file_tag_fail',
          name: 'Tag_Fail.pdf',
          mimeType: 'application/pdf',
          webViewLink: 'https://drive.google.com/file_tag_fail',
          description: JSON.stringify({
            tradeCategory: 'Exterior',
            tradePhase: 'Landscaping & Irrigation',
            vendor: 'Vendor X',
            amount: 500
          })
        }
      ];

      setupBatchMockFetch({ files, failOnTagForFileId: 'file_tag_fail' });

      const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');

      assert.equal(result.processedCount, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].fileId, 'file_tag_fail');
      assert.ok(result.failed[0].reason.includes('could not be tagged in Drive'));
      assert.equal(movedFiles.length, 0, 'File must NOT be moved if tagging fails');
    });
  });
});
