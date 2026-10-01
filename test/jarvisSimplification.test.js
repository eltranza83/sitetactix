import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPurchasingItemGrounded,
  isExpenseGrounded,
  verifyActionExecutionClaims
} from '../src/services/jarvis/verify.js';

import {
  setPendingAction,
  getActivePending,
  clearPendingAction,
  checkAndHandlePending,
  stripModelConfirmedArg,
  isUserNegative
} from '../src/services/jarvis/pending.js';
import { parseCategorySheet } from '../src/services/sheetsDataService.js';

import {
  LedgerSource,
  extractDriveIdFromFormula
} from '../src/services/jarvis/sources/ledgerSource.js';

import {
  stage_expense,
  findCategoryForPhase,
  getAllCanonicalPhases
} from '../src/services/jarvis/tools/expenses.js';

import {
  get_purchasing_list,
  add_purchasing_item,
  set_purchasing_status,
  remove_purchasing_item
} from '../src/services/jarvis/tools/purchasing.js';

import { purchasingService, LocalStoragePurchasingAdapter } from '../src/services/purchasingService.js';
import {
  list_folder_files,
  open_file,
  normalizeDriveName,
  extractAllFolders,
  clearSessionDriveListing,
  getSessionDriveListing,
  escapeDriveQueryString
} from '../src/services/jarvis/tools/drive.js';
import { search_payments } from '../src/services/jarvis/tools/money.js';

import lot3Fixture from './jarvis-eval/lot3-fixture.json' with { type: 'json' };

function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

describe('v1.4.0 Jarvis Simplification Core Suite', () => {
  beforeEach(() => {
    globalThis.localStorage = createMockStorage();
    clearPendingAction();
    clearSessionDriveListing();
    purchasingService.setStorageAdapter(new LocalStoragePurchasingAdapter());
  });

  describe('1. Verification & Safety Guards (verify.js)', () => {
    test('isPurchasingItemGrounded handles singular/plural, stems, and accents', () => {
      assert.equal(isPurchasingItemGrounded('exhaust fans', 'add two exhaust fans to the list'), true);
      assert.equal(isPurchasingItemGrounded('exhaust fan', 'add two exhaust fans to the list'), true);
      assert.equal(isPurchasingItemGrounded('ceiling fans', 'check if we already bought the ceiling fan'), true);
      assert.equal(isPurchasingItemGrounded('ventiladores', 'agrega un ventilador para el baño'), true);
      assert.equal(isPurchasingItemGrounded('ring doorbell', 'Add a ring doorbell to the electrician purchasing list'), true);
      assert.equal(isPurchasingItemGrounded('copper pipes', 'add two exhaust fans to the list'), false);
    });

    test('isExpenseGrounded verifies vendor and amount', () => {
      assert.equal(isExpenseGrounded('Stripes', 50, 'I just pumped the gas at Stripes today for $50'), true);
      assert.equal(isExpenseGrounded('Home Depot', 125.50, 'spent $125.50 at Home Depot on lumber'), true);
      assert.equal(isExpenseGrounded('Unknown Vendor', 500, 'I spent money on tools'), false);
    });

    test('verifyActionExecutionClaims blocks unexecuted write claims', () => {
      const claimReply = "I have successfully added the ring doorbell to your list.";
      const query = "Add a ring doorbell";
      // No executed write tools
      const verified = verifyActionExecutionClaims(claimReply, query, []);
      assert.equal(verified, "I didn't complete that. Which item or action did you mean?");

      // With executed write tool
      const passVerified = verifyActionExecutionClaims(claimReply, query, [{ name: 'add_purchasing_item', isWrite: true, ok: true }]);
      assert.equal(passVerified, claimReply);
    });

    test('verifyActionExecutionClaims intercepts refusal claims', () => {
      const refusalReply = "As an AI, I do not have authorization to modify the purchasing list.";
      const query = "Add a ring doorbell";
      const verified = verifyActionExecutionClaims(refusalReply, query, []);
      assert.equal(verified, "I didn't complete that. Which item or action did you mean?");
    });
  });

  describe('2. Pending Confirmations & Safety (pending.js)', () => {
    test('stripModelConfirmedArg removes confirmed property from model args', () => {
      const raw = { vendor: 'Stripes', amount: 50, confirmed: true };
      const safe = stripModelConfirmedArg(raw);
      assert.equal(safe.confirmed, undefined);
      assert.equal(safe.vendor, 'Stripes');
    });

    test('two-step confirmation executes callback on affirmative user reply', async () => {
      let executed = false;
      setPendingAction({
        type: 'stage_expense',
        projectId: 'lot_3',
        preview: { vendor: 'Stripes', amount: 50 },
        executeCallback: async () => {
          executed = true;
          return { message: 'Draft created.' };
        }
      });

      assert.ok(getActivePending());

      const res = await checkAndHandlePending('yes, please go ahead', 'lot_3');
      assert.equal(res.handled, true);
      assert.equal(res.confirmed, true);
      assert.equal(executed, true);
      assert.equal(getActivePending(), null);
    });

    test('"yes, but make it $60" does not confirm and is treated as unhandled extra content', async () => {
      let executed = false;
      setPendingAction({
        type: 'stage_expense',
        projectId: 'lot_3',
        preview: { vendor: 'Stripes', amount: 50 },
        executeCallback: async () => {
          executed = true;
          return { message: 'Draft created.' };
        }
      });

      const res = await checkAndHandlePending('yes, but make it $60', 'lot_3');
      assert.equal(res.handled, false);
      assert.equal(executed, false);
      assert.ok(getActivePending(), 'Pending action should remain active for model to review');
    });

    test('cancellation clears pending state without executing callback', async () => {
      let executed = false;
      setPendingAction({
        type: 'stage_expense',
        projectId: 'lot_3',
        preview: { vendor: 'Stripes', amount: 50 },
        executeCallback: async () => {
          executed = true;
        }
      });

      const res = await checkAndHandlePending('no, cancel that', 'lot_3');
      assert.equal(res.handled, true);
      assert.equal(res.confirmed, false);
      assert.equal(executed, false);
      assert.equal(getActivePending(), null);
    });
  });

  describe('3. LedgerSource & Financial Lookups (ledgerSource.js)', () => {
    let ledger;

    beforeEach(() => {
      ledger = new LedgerSource(lot3Fixture, lot3Fixture.syncHistory, {
        'Paint_Tile_C2': 'drive_floor_decor_101',
        'Paint_Tile_C3': 'drive_bodilios_102'
      });
    });

    test('extractDriveIdFromFormula parses Drive file id from HYPERLINK', () => {
      const formula = '=HYPERLINK("https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view", 3450.00)';
      assert.equal(extractDriveIdFromFormula(formula), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    });

    test('getSummary returns correct project financials', () => {
      const summary = ledger.getSummary();
      assert.equal(summary.projectName, 'Lot 3');
      assert.equal(summary.budgetBuild, '$410,000.00');
      assert.equal(summary.totalSpent, '$186,450.00');
      assert.equal(summary.cashOnHand, '$42,500.00');
      assert.ok(summary.stillOwed.includes('19,500.00')); // 6500 + 4500 + 0 + 4500 + 4000 = 19500
    });

    test('getContractors matches exact or substring name/phase/category', () => {
      const elecResult = ledger.getContractors('Volt Masters');
      assert.equal(elecResult.matched, true);
      assert.equal(elecResult.contractors[0].name, 'Volt Masters Electrical');
      assert.equal(elecResult.contractors[0].stillOwed, '$6,500.00');

      const plumbResult = ledger.getContractors('Plumbing');
      assert.equal(plumbResult.matched, true);
      assert.equal(plumbResult.contractors[0].name, 'Apex Plumbing Services');
      assert.equal(plumbResult.contractors[0].stillOwed, '$4,500.00');
    });

    test('getContractors returns full contractor list on no exact match for model to resolve', () => {
      const noMatch = ledger.getContractors('electricista');
      assert.equal(noMatch.matched, false);
      assert.ok(noMatch.contractors.length > 0);
      assert.equal(noMatch.contractors.length, lot3Fixture.subcontractors.length);
      assert.ok(noMatch.contractors.some(c => c.name === 'Volt Masters Electrical'));
      assert.ok(noMatch.contractors.some(c => c.name === 'Apex Plumbing Services'));
      assert.ok(noMatch.message.includes('No exact contractor match found'));
    });

    test('getSpending breaks down spending by phase and category', () => {
      const framingResult = ledger.getSpending({ phase: 'Framing' });
      assert.ok(framingResult.byPhase.length > 0);
      assert.equal(framingResult.byPhase[0].phase, 'Framing Lumber & Truss');
      assert.equal(framingResult.byPhase[0].totalSpent, '$75,200.00');
      assert.equal(framingResult.byPhase[0].materialSpent, '$41,200.00');
      assert.equal(framingResult.byPhase[0].laborSpent, '$34,000.00');
    });

    test('getTransactions fuzzy matches vendor with speech-to-text slip (Vodilias Tile)', () => {
      const txs = ledger.getTransactions({ vendor: 'Vodilias Tile' });
      assert.ok(txs.length > 0);
      assert.equal(txs[0].vendor, 'Bodilios Tile');
      const receiptTx = txs.find(t => t.driveFileId);
      assert.ok(receiptTx);
      assert.equal(receiptTx.driveFileId, 'drive_bodilios_102');
    });

    test('getTransactions enriches lineItems with SKU for reorders', () => {
      const txs = ledger.getTransactions({ vendor: 'Floor & Decor', text: 'subway tile' });
      assert.ok(txs.length > 0);
      const showerTile = txs[0].lineItems.find(li => li.description.includes('Shower'));
      assert.ok(showerTile);
      assert.equal(showerTile.sku, 'FD-SUB-9821');
      assert.equal(showerTile.unitPrice, 42.50);
      assert.equal(showerTile.unit, 'box');
    });
  });

  describe('4. Purchasing Tools (tools/purchasing.js)', () => {
    test('add_purchasing_item requires trade selection if missing', async () => {
      const res = await add_purchasing_item({ item: 'ring doorbell' }, { projectId: 'lot_3' });
      assert.equal(res.ok, false);
      assert.equal(res.needs, 'trade');
      assert.deepEqual(res.options, ['quartz', 'electrical', 'plumbing']);
    });

    test('add_purchasing_item adds item with trade', async () => {
      const res = await add_purchasing_item({ item: 'ring doorbell', trade: 'electrical' }, { projectId: 'lot_3' });
      assert.equal(res.ok, true);
      assert.equal(res.added, true);

      // Verify item is now in checklist
      const listRes = await get_purchasing_list({ trade: 'electrical' }, { projectId: 'lot_3' });
      assert.ok(listRes.data.items.some(i => i.item.toLowerCase().includes('ring doorbell')));
    });

    test('Instruction 6b: set_purchasing_status marks item purchased rather than deleting', async () => {
      // Add toilets
      await add_purchasing_item({ item: 'toilets', trade: 'plumbing' }, { projectId: 'lot_3' });

      // User says we already bought toilets -> mark purchased
      const updateRes = await set_purchasing_status({ item: 'toilets', status: 'purchased' }, { projectId: 'lot_3' });
      assert.equal(updateRes.ok, true);
      assert.equal(updateRes.status, 'purchased');

      // Verify item still exists on list under purchased status
      const listRes = await get_purchasing_list({ trade: 'plumbing' }, { projectId: 'lot_3' });
      const toiletItem = listRes.data.items.find(i => i.item.toLowerCase().includes('toilet'));
      assert.ok(toiletItem);
      assert.equal(toiletItem.status, 'purchased');
      assert.equal(toiletItem.isPurchased, true);
    });

    test('set_purchasing_status returns ok:false when updateItemStatus fails', async () => {
      const failingAdapter = {
        getItems: async () => [{ id: 'mock-item-1', itemName: 'Faulty Item', categoryId: 'electrical', status: 'needed' }],
        saveItems: async () => { throw new Error('Firestore write error'); }
      };
      purchasingService.setStorageAdapter(failingAdapter);

      const res = await set_purchasing_status({ item: 'Faulty Item', status: 'purchased' }, { projectId: 'lot_3' });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'update_failed');
    });

    test('remove_purchasing_item removes item only when explicit', async () => {
      await add_purchasing_item({ item: 'extra exhaust fans', trade: 'electrical' }, { projectId: 'lot_3' });
      const delRes = await remove_purchasing_item({ item: 'extra exhaust fans', trade: 'electrical' }, { projectId: 'lot_3' });
      assert.equal(delRes.ok, true);
      assert.equal(delRes.removed, true);

      const listRes = await get_purchasing_list({ trade: 'electrical' }, { projectId: 'lot_3' });
      assert.ok(!listRes.data.items.some(i => i.item.includes('extra exhaust fans')));
    });
  });

  describe('5. Expense Staging Tool (tools/expenses.js)', () => {
    test('stage_expense requires confirmation and validates canonical phase', async () => {
      const res = await stage_expense({
        vendor: 'Stripes',
        amount: 50,
        description: 'Gas',
        costType: 'material',
        phase: 'Extra Costs & Misc'
      }, { projectId: 'lot_3', projectName: 'Lot 3' });

      assert.equal(res.ok, true);
      assert.equal(res.requiresConfirmation, true);
      assert.ok(res.preview);
      assert.equal(res.preview.vendor, 'Stripes');
      assert.equal(res.preview.phase, 'Extra Costs & Misc');

      // Check pending action created
      const pending = getActivePending();
      assert.ok(pending);
      assert.equal(pending.type, 'stage_expense');

      // On confirm, draft is saved to localStorage
      const confirmRes = await checkAndHandlePending('yes', 'lot_3');
      assert.equal(confirmRes.handled, true);
      assert.equal(confirmRes.confirmed, true);

      const rawStaged = localStorage.getItem('jobscan_staged_items');
      assert.ok(rawStaged);
      const parsed = JSON.parse(rawStaged);
      assert.equal(parsed[0].metadata.vendor, 'Stripes');
      assert.equal(parsed[0].metadata.amount, 50);
      assert.equal(parsed[0].metadata.tradePhase, 'Extra Costs & Misc');
    });

    test('stage_expense defaults to local calendar date (YYYY-MM-DD)', async () => {
      const res = await stage_expense({
        vendor: 'Home Depot',
        amount: 45,
        phase: 'Framing Lumber & Truss'
      }, { projectId: 'lot_3', projectName: 'Lot 3' });

      assert.equal(res.ok, true);
      assert.ok(res.preview);
      const now = new Date();
      const expectedLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      assert.equal(res.preview.date, expectedLocalDate);
    });

    test('stage_expense rejects invalid non-canonical phase', async () => {
      const res = await stage_expense({
        vendor: 'Home Depot',
        amount: 100,
        description: 'Tools',
        costType: 'material',
        phase: 'Random Nonexistent Phase'
      }, { projectId: 'lot_3' });

      assert.equal(res.ok, false);
      assert.equal(res.needs, 'phase');
      assert.ok(Array.isArray(res.options));
    });
  });

  describe('6. Spanish Speech Slips & Bilingual Lookup Suite (S1-S4)', () => {
    test('S1/S2: LedgerSource returns all contractors on Spanish query so model resolves trade', async () => {
      const ledger = new LedgerSource(lot3Fixture);
      
      const electricianRes = ledger.getContractors('electricista');
      assert.equal(electricianRes.matched, false);
      assert.ok(electricianRes.contractors.some(c => c.name === 'Volt Masters Electrical' && c.phase.toLowerCase().includes('electrical')));

      const slipRes = ledger.getContractors('eletricista');
      assert.equal(slipRes.matched, false);
      assert.ok(slipRes.contractors.some(c => c.name === 'Volt Masters Electrical'));

      const plumberRes = ledger.getContractors('plomero');
      assert.equal(plumberRes.matched, false);
      assert.ok(plumberRes.contractors.some(c => c.name === 'Apex Plumbing Services' && c.phase.toLowerCase().includes('plumbing')));
    });

    test('S3: get_purchasing_list maps Spanish trade and returns only needed items', async () => {
      const res = await get_purchasing_list({ trade: 'electricista', onlyNeeded: true }, { projectId: 'lot_3' });
      assert.equal(res.ok, true);
      assert.equal(res.data.trade, 'electrical');
      assert.ok(res.data.items.every(i => !i.isPurchased));
    });
  });

  describe('7. Drive Folder Browsing and File Opening (tools/drive.js)', () => {
    test('normalizeDriveName normalizes case, accents, and punctuation', () => {
      assert.equal(normalizeDriveName('Home Depot'), 'home depot');
      assert.equal(normalizeDriveName("  Lowe's!  "), 'lowe s');
      assert.equal(normalizeDriveName('Café & Décor'), 'cafe decor');
    });

    test('extractAllFolders recursively discovers folders across all levels', () => {
      const folders = extractAllFolders(lot3Fixture.driveTree);
      const names = folders.map(f => f.name);
      assert.ok(names.includes('Home Depot'));
      assert.ok(names.includes("Lowe's"));
      assert.ok(names.includes('Floor & Decor'));
    });

    test('list_folder_files matches folder exactly and returns files', async () => {
      const res = await list_folder_files(
        { folder: 'Home Depot' },
        { driveTree: lot3Fixture.driveTree }
      );
      assert.equal(res.ok, true);
      assert.equal(res.folderName, 'Home Depot');
      assert.equal(res.count, 2);
      assert.ok(res.files.some(f => f.name.includes('2x4 Lumber')));
      assert.ok(res.files.some(f => f.name.includes('Tile mortar')));

      const sessionListing = getSessionDriveListing();
      assert.ok(sessionListing);
      assert.equal(sessionListing.folderName, 'Home Depot');
      assert.equal(sessionListing.files.length, 2);
    });

    test('list_folder_files returns candidates when folder is not matched', async () => {
      const res = await list_folder_files(
        { folder: 'Hindipo' },
        { driveTree: lot3Fixture.driveTree }
      );
      assert.equal(res.ok, false);
      assert.equal(res.error, 'folder_not_found');
      assert.ok(Array.isArray(res.candidates));
      assert.ok(res.candidates.includes('Home Depot'));
      assert.ok(res.candidates.includes("Lowe's"));
    });

    test('open_file rejects unauthorized file IDs not in recent session', async () => {
      const res = await open_file({ fileId: 'drv_unauthorized_999' });
      assert.equal(res.ok, false);
      assert.equal(res.error, 'unauthorized_file');
    });

    test('open_file opens authorized file ID and calls onOpenDocument', async () => {
      // First list files to authorize them
      await list_folder_files(
        { folder: 'Home Depot' },
        { driveTree: lot3Fixture.driveTree }
      );

      let openedDoc = null;
      const res = await open_file(
        { fileId: 'drv_hd_02' },
        { onOpenDocument: (doc) => { openedDoc = doc; } }
      );

      assert.equal(res.ok, true);
      assert.equal(res.opened, true);
      assert.equal(res.fileId, 'drv_hd_02');
      assert.ok(openedDoc);
      assert.equal(openedDoc.id, 'drv_hd_02');
      assert.ok(openedDoc.name.includes('Tile mortar'));
    });

    test('search_payments authorizes found transaction receipt file IDs for open_file', async () => {
      const ledger = new LedgerSource(lot3Fixture);
      const searchRes = await search_payments({ vendor: 'Bodilios' }, { ledgerSource: ledger });
      assert.equal(searchRes.ok, true);

      let openedDoc = null;
      const openRes = await open_file(
        { fileId: 'drive_bodilios_102' },
        { onOpenDocument: (doc) => { openedDoc = doc; } }
      );

      assert.equal(openRes.ok, true);
      assert.equal(openRes.fileId, 'drive_bodilios_102');
      assert.ok(openedDoc);
    });
  });

  describe('8. Re-Review Fixes: Underscore Sheet Hyperlinks, Blank Rows, Unclear Pending & Summary Breakdown', () => {
    test('parseCategorySheet records categorySheetName and preserves exact rowNumber despite blank rows', () => {
      // Row 1: Header (r=0)
      // Row 2: Phase header (r=1) -> sheet row 2
      // Row 3: Transaction 1 (r=2) -> sheet row 3
      // Row 4: Empty row (r=3, skipped by parser)
      // Row 5: Transaction 2 (r=4) -> sheet row 5
      const sheetName = 'Framing_&_Lumber';
      const rows = [
        ['Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
        ['→ Framing Lumber & Truss', '', '$0.00', '$0.00', '', '', 'Timberline Framing', '$0.00', '$34,000.00', '$0.00', 'In Progress'],
        ['lumber delivery', 'Builders FirstSource', '$41,200.00', '$0.00', '2026-06-15', '1001', '', '', '', '', ''],
        [], // blank row inside phase block
        ['truss package', 'Timberline Framing', '$0.00', '$34,000.00', '2026-07-02', '1008', '', '', '', '', '']
      ];

      const contractors = parseCategorySheet(sheetName, rows);
      assert.equal(contractors.length, 1);
      assert.equal(contractors[0].categorySheetName, 'Framing_&_Lumber');
      assert.equal(contractors[0].phase, 'Framing Lumber & Truss');
      assert.equal(contractors[0].payments.length, 2);

      // Verify row numbers do NOT drift due to blank row
      assert.equal(contractors[0].payments[0].rowNumber, 3);
      assert.equal(contractors[0].payments[1].rowNumber, 5); // Row index r=4 -> sheet row 5

      // Verify LedgerSource matches formula hyperlinks using the underscore sheet name
      const formulaHyperlinks = {
        'Framing_&_Lumber_C3': 'drive_bfs_lumber_123',
        'Framing_&_Lumber_D5': 'drive_timberline_labor_456'
      };

      const ledger = new LedgerSource(
        { projectInfo: {}, subcontractors: contractors, categories: [] },
        [],
        formulaHyperlinks
      );

      const tx = ledger.getTransactions({ vendor: 'Timberline Framing' });
      assert.equal(tx.length, 1);
      assert.equal(tx[0].driveFileId, 'drive_timberline_labor_456');

      const matTx = ledger.getTransactions({ vendor: 'Builders FirstSource' });
      assert.equal(matTx.length, 1);
      assert.equal(matTx[0].driveFileId, 'drive_bfs_lumber_123');
    });

    test('pending.js: polite words (thanks, gracias, please, por favor) do NOT cancel pending actions', () => {
      assert.equal(isUserNegative('thanks'), false);
      assert.equal(isUserNegative('gracias'), false);
      assert.equal(isUserNegative('please'), false);
      assert.equal(isUserNegative('por favor'), false);
      assert.equal(isUserNegative('thank you'), false);

      // True negative words still cancel cleanly
      assert.equal(isUserNegative('no'), true);
      assert.equal(isUserNegative('nope'), true);
      assert.equal(isUserNegative('cancel'), true);
      assert.equal(isUserNegative('cancel that'), true);
      assert.equal(isUserNegative('cancela'), true);
    });

    test('getSummary(): only returns material/labor breakdown if they sum to totalSpent', () => {
      // Case A: Discrepancy (subcontractors sum 135,000, projectInfo.totalSpent is 186,450)
      const ledgerA = new LedgerSource(lot3Fixture);
      const summaryA = ledgerA.getSummary();
      assert.equal(summaryA.totalSpent, '$186,450.00');
      assert.equal(summaryA.materialSpent, undefined);
      assert.equal(summaryA.laborSpent, undefined);

      // Case B: Consistent (subcontractors sum 100,000, projectInfo.totalSpent is 100,000)
      const ledgerB = new LedgerSource({
        projectInfo: { totalSpent: '$100,000.00' },
        subcontractors: [
          { totalMaterial: '$40,000.00', totalLabor: '$60,000.00', remainingBalance: '$5,000.00' }
        ]
      });
      const summaryB = ledgerB.getSummary();
      assert.equal(summaryB.totalSpent, '$100,000.00');
      assert.equal(summaryB.materialSpent, '$40,000.00');
      assert.equal(summaryB.laborSpent, '$60,000.00');
    });
  });

  describe('9. v1.4.1 Live Drive Folder Discovery & Error Handling', () => {
    test('escapeDriveQueryString escapes backslashes and apostrophes', () => {
      assert.equal(escapeDriveQueryString("Lowe's"), "Lowe\\'s");
      assert.equal(escapeDriveQueryString("Path\\To\\Folder"), "Path\\\\To\\\\Folder");
      assert.equal(escapeDriveQueryString("O'Reilly's & Home Depot"), "O\\'Reilly\\'s & Home Depot");
    });

    test('list_folder_files resolves folder live when driveTree is null/empty', async () => {
      // Mock fetchImpl simulating live Drive API responses
      async function mockDriveFetch(url) {
        const decodedUrl = decodeURIComponent(url);
        // 1. Folder search query by name (with apostrophe escaping)
        if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'") && decodedUrl.includes("name = 'Lowe\\'s'")) {
          return {
            ok: true,
            json: async () => ({
              files: [
                { id: 'fld_lowes_live_99', name: "Lowe's", parents: ['project_lot3_root'] }
              ]
            })
          };
        }
        // 2. Folder files query
        if (decodedUrl.includes("'fld_lowes_live_99' in parents")) {
          return {
            ok: true,
            json: async () => ({
              files: [
                { id: 'file_drywall_1', name: 'Drywall screws - Aug 15.pdf', createdTime: '2026-08-15T10:00:00Z', size: 102400 }
              ]
            })
          };
        }
        return { ok: false, status: 404 };
      }

      const res = await list_folder_files(
        { folder: "Lowe's" },
        {
          driveTree: null, // empty/null tree
          googleToken: 'mock_token_abc',
          projectFolderId: 'project_lot3_root',
          fetchImpl: mockDriveFetch
        }
      );

      assert.equal(res.ok, true);
      assert.equal(res.folderName, "Lowe's");
      assert.equal(res.folderId, 'fld_lowes_live_99');
      assert.equal(res.count, 1);
      assert.equal(res.files[0].name, 'Drywall screws - Aug 15.pdf');
    });

    test('list_folder_files filters out folders not belonging to projectFolderId', async () => {
      async function mockDriveFetch(url) {
        const decodedUrl = decodeURIComponent(url);
        if (decodedUrl.includes("name = 'Home Depot'")) {
          return {
            ok: true,
            json: async () => ({
              files: [
                { id: 'fld_hd_other_project', name: 'Home Depot', parents: ['other_lot_root'] }
              ]
            })
          };
        }
        // Parent check for fld_hd_other_project
        if (decodedUrl.includes('/files/fld_hd_other_project?fields=parents')) {
          return {
            ok: true,
            json: async () => ({ parents: ['other_lot_root'] })
          };
        }
        return { ok: true, json: async () => ({ files: [] }) };
      }

      const res = await list_folder_files(
        { folder: 'Home Depot' },
        {
          driveTree: null,
          googleToken: 'mock_token_abc',
          projectFolderId: 'my_active_lot_root',
          fetchImpl: mockDriveFetch
        }
      );

      // Other project folder was filtered out, and no candidates exist -> returns folder_not_found
      assert.equal(res.ok, false);
      assert.equal(res.error, 'folder_not_found');
      assert.equal(res.message, 'I couldn\'t find a folder named "Home Depot" in this project.');
      assert.equal(res.candidates, undefined);
    });

    test('list_folder_files returns timeout message when full-tree crawl times out', async () => {
      async function mockHangingFetch(url) {
        const decodedUrl = decodeURIComponent(url);
        if (decodedUrl.includes("mimeType = 'application/vnd.google-apps.folder'")) {
          return { ok: true, json: async () => ({ files: [] }) };
        }
        return new Promise(() => {});
      }

      const res = await list_folder_files(
        { folder: 'Lumber' },
        {
          driveTree: null,
          googleToken: 'mock_token_abc',
          projectFolderId: 'my_active_lot_root',
          fetchImpl: mockHangingFetch,
          timeoutMs: 50
        }
      );

      assert.equal(res.ok, false);
      assert.equal(res.error, 'folder_not_found');
      assert.ok(res.message.includes('Your project has a lot of folders. Try the exact folder name.'));
    });

    test('list_folder_files returns drive_unavailable when Drive returns 500 error', async () => {
      async function mockFailingFetch() {
        return { ok: false, status: 500 };
      }

      const res = await list_folder_files(
        { folder: 'Home Depot' },
        {
          driveTree: null,
          googleToken: 'mock_token_abc',
          projectFolderId: 'project_123',
          fetchImpl: mockFailingFetch
        }
      );

      assert.equal(res.ok, false);
      assert.equal(res.error, 'drive_unavailable');
      assert.ok(res.message.includes("couldn't reach Google Drive"));
    });

    test('list_folder_files returns drive_unavailable when tree is empty and Google Drive cannot be reached', async () => {
      const res = await list_folder_files(
        { folder: 'Home Depot' },
        {
          driveTree: null,
          googleToken: null, // no token
          projectFolderId: 'project_123'
        }
      );

      assert.equal(res.ok, false);
      assert.equal(res.error, 'drive_unavailable');
      assert.ok(res.message.includes("couldn't reach Google Drive"));
      assert.equal(res.candidates, undefined); // NEVER empty candidates list
    });
  });
});
