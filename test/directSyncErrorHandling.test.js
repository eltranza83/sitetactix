import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncUploadedInvoicesDirectly } from '../src/services/directSyncService.js';

describe('Direct Sync Robustness & Failure Isolation Suite', () => {
  const originalFetch = globalThis.fetch;
  let movedFiles = [];

  beforeEach(() => {
    movedFiles = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function setupMockFetch({ insertOk = true, writeOk = true } = {}) {
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
            json: async () => ({
              files: [{
                id: 'invoice_file_999',
                name: 'Vendor_Invoice.pdf',
                mimeType: 'application/pdf',
                webViewLink: 'https://drive.google.com/file/d/invoice_file_999/view',
                description: JSON.stringify({
                  tradeCategory: 'Exterior',
                  tradePhase: 'Landscaping & Irrigation',
                  vendor: 'L. Herrera Landscaping',
                  amount: 1500,
                  date: '2026-06-01'
                })
              }]
            })
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
          json: async () => ({ files: [{ id: 'vendor_folder_777', name: 'L. Herrera Landscaping' }] })
        };
      }

      // 2. Google Drive move file (patching parents)
      if (rawUrl.includes('googleapis.com/drive/v3/files/invoice_file_999') && method === 'PATCH') {
        movedFiles.push({ fileId: 'invoice_file_999', options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'invoice_file_999' })
        };
      }

      // 3. Google Sheets Metadata
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

      // 4. Google Sheets Range fetch
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
                ['Existing Row 1', 'Vendor A', '100', '', '2026-05-01', ''],
                ['→ Next Phase Header'] // Forces needsRowInsertion: true
              ]
            })
          };
        }

        // 6. Values PUT (row update)
        if (method === 'PUT') {
          if (!writeOk) {
            return {
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              text: async () => 'Invalid cell bounds'
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ updatedRows: 1 })
          };
        }
      }

      // 5. Batch update (row insert)
      if (rawUrl.includes(':batchUpdate') && method === 'POST') {
        if (!insertOk) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'Quota exceeded on sheet batchUpdate'
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ replies: [{ insertDimension: {} }] })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({})
      };
    };
  }

  it('fails loudly when row insertion (insertDimension) fails and leaves file in Uploads', async () => {
    setupMockFetch({ insertOk: false, writeOk: true });

    await assert.rejects(
      async () => {
        await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');
      },
      /Failed to insert row for expanded phase block/
    );

    assert.equal(movedFiles.length, 0, 'File must NOT be moved out of Uploads if row insertion fails');
  });

  it('fails loudly when row write (PUT) fails and leaves file in Uploads', async () => {
    setupMockFetch({ insertOk: true, writeOk: false });

    await assert.rejects(
      async () => {
        await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');
      },
      /Failed to write invoice row to "Exterior"/
    );

    assert.equal(movedFiles.length, 0, 'File must NOT be moved out of Uploads if row write fails');
  });

  it('successfully writes row and moves file to vendor folder when all checks pass', async () => {
    setupMockFetch({ insertOk: true, writeOk: true });

    const result = await syncUploadedInvoicesDirectly('mock-token', 'mock-project-folder');
    assert.equal(result.ok, true);
    assert.equal(result.processedCount, 1);
    assert.equal(movedFiles.length, 1, 'File should be safely moved to vendor folder upon verified write');
  });
});
