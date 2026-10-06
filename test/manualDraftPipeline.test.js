import assert from 'node:assert/strict';
import test from 'node:test';

// Polyfill localStorage for the Node.js test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

import { loadStoredAppState, persistStagedItems } from '../src/services/appStorage.js';
import { generateDocumentPDF } from '../src/services/pdfGenerator.js';
import { buildHistoryLogs, buildInvoiceFileName } from '../src/services/invoiceUpload.js';

test.beforeEach(() => {
  persistStagedItems([]);
});

test('a manual (no-receipt) check draft builds a PDF voucher, filename and history log like a scanned one', async () => {
  const metadata = {
    type: 'check',
    vendor: 'Rios Plumbing',
    payee: 'Rios Plumbing',
    amount: 2500.0,
    date: '2026-08-25',
    lotNumber: 'Lot 3',
    costCategory: 'labor',
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In',
    description: 'Rough plumbing draw',
    checkNumber: '1045',
    documentType: 'check',
    receiptStatus: 'no_receipt',
    provenance: 'manual_user_entry',
    splits: []
  };

  const pdfBlob = await generateDocumentPDF(metadata, []);
  assert.ok(pdfBlob);
  assert.equal(pdfBlob.type, 'application/pdf');
  assert.ok(pdfBlob.size > 1000);

  assert.equal(buildInvoiceFileName(metadata), 'Lot 3 - Rough plumbing draw - labor.pdf');

  const logs = buildHistoryLogs(metadata, { idPrefix: 'sync_doc_101', link: 'https://drive.google.com/file/d/123' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, 'sync_doc_101');
  assert.equal(logs[0].vendor, 'Rios Plumbing');
  assert.equal(logs[0].amount, 2500.0);
  assert.equal(logs[0].tradeCategory, 'Mechanicals_&_Utilities');
  assert.equal(logs[0].tradePhase, 'Plumbing Rough-In');
  assert.equal(logs[0].costCategory, 'labor');
  assert.equal(logs[0].link, 'https://drive.google.com/file/d/123');
});

test('a Jarvis voice draft (no receipt) also builds its PDF and history log', async () => {
  const metadata = {
    type: 'manual_expense',
    vendor: 'Stripes',
    payee: 'Stripes',
    amount: 50,
    date: '2026-10-05',
    lotNumber: 'Lot 3',
    costCategory: 'material',
    tradeCategory: 'Project_Overhead_&_Bills',
    tradePhase: 'Extra Costs & Misc',
    description: 'Gas',
    checkNumber: '',
    documentType: 'manual_expense',
    receiptStatus: 'no_receipt',
    provenance: 'jarvis_voice_stage',
    splits: null
  };

  const pdfBlob = await generateDocumentPDF(metadata, []);
  assert.equal(pdfBlob.type, 'application/pdf');
  assert.ok(pdfBlob.size > 1000);

  const logs = buildHistoryLogs(metadata, { idPrefix: 'sync_doc_102', link: 'https://drive.google.com/file/d/456' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].vendor, 'Stripes');
  assert.equal(logs[0].tradePhase, 'Extra Costs & Misc');
});

test('scanned receipt drafts with images are stored untouched', () => {
  const ocrDraft = {
    id: 'draft_ocr_test_1',
    metadata: {
      vendor: 'Home Depot',
      amount: 345.6,
      date: '2026-08-20',
      lotNumber: 'Lot 3',
      costCategory: 'material',
      tradeCategory: 'Framing_&_Lumber',
      tradePhase: 'Hardware & Fasteners',
      description: 'Framing nails & Simpson ties',
      documentType: 'invoice',
      receiptStatus: 'attached',
      provenance: 'ocr_scan',
      splits: []
    },
    mainImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    secondaryImageBase64: null,
    createdAt: Date.now()
  };

  persistStagedItems([ocrDraft]);
  const appState = loadStoredAppState();
  assert.equal(appState.stagedItems.length, 1);
  assert.equal(appState.stagedItems[0].metadata.provenance, 'ocr_scan');
  assert.equal(appState.stagedItems[0].metadata.receiptStatus, 'attached');
  assert.ok(appState.stagedItems[0].mainImageBase64 !== null);
});
