import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSheetMatch, findReceiptInSheet } from '../src/services/dailyCheck.js';
import { parseTransactions } from '../src/services/sheetV2.js';

// Lot 99 -New Test as it is now: the Home Depot receipt synced Oct 12 as 4 splits, then the Lucen check
const sheetRows = parseTransactions([
  ['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check', 'Receipt', 'Receipt ID'],
  ['2023-10-26', 'Home Depot', 'Deck screws', 'Framing & Lumber', 'Framing Lumber & Truss', 31.58, '', '', '', 'draft_hd_split_0'],
  ['2023-10-26', 'Home Depot', 'Switches', 'Interior Hardware', 'Electrical Hardware Fixtures', 20.15, '', '', '', 'draft_hd_split_1'],
  ['2023-10-26', 'Home Depot', 'Wire box', 'Mechanicals & Utilities', 'Electrical & Lighting', 3.05, '', '', '', 'draft_hd_split_2'],
  ['2023-10-26', 'Home Depot', 'PVC', 'Mechanicals & Utilities', 'Plumbing Rough-In', 101.82, '', '', '', 'draft_hd_split_3'],
  ['2026-10-12', 'Lucen LLC', 'Electrical labor', 'Mechanicals & Utilities', 'Electrical & Lighting', '', 2000, '1545', '', 'draft_lucen'],
  ['2026-10-01', 'Imco Lumber', 'Typed by hand', 'Framing & Lumber', 'Framing Lumber & Truss', 340.47, '', '', '', '']
]);

test('the same Home Depot receipt scanned again (split differently) is found in rows 2-5', () => {
  const rescan = {
    vendor: 'Home Depot',
    date: '2023-10-26',
    amount: 156.6,
    splits: [{ amount: 133.4 }, { amount: 3.05 }, { amount: 20.15 }, { amount: 0 }]
  };
  const match = findReceiptInSheet(rescan, sheetRows, 'draft_new');
  assert.deepEqual(match.rows, [2, 3, 4, 5]);
  assert.equal(describeSheetMatch(match), 'Home Depot $156.60 on 2023-10-26 is already in the Sheet (rows 2-5).');
});

test('a check scanned twice is found, even with the date written differently', () => {
  const match = findReceiptInSheet({ vendor: 'lucen llc', date: '10/12/2026', amount: 2000, costCategory: 'labor' }, sheetRows, 'draft_again');
  assert.deepEqual(match.rows, [6]);
});

test('a row typed into the Sheet by hand (no Receipt ID) counts too', () => {
  const match = findReceiptInSheet({ vendor: 'Imco Lumber', date: '2026-10-01', amount: 340.47 }, sheetRows, 'd1');
  assert.deepEqual(match.rows, [7]);
});

test('different total, date or payee is not a duplicate', () => {
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '2023-10-26', amount: 156.59 }, sheetRows, 'd'), null);
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '2023-10-27', amount: 156.6 }, sheetRows, 'd'), null);
  assert.equal(findReceiptInSheet({ vendor: 'Lowes', date: '2023-10-26', amount: 156.6 }, sheetRows, 'd'), null);
  // One split's amount alone is not the whole receipt
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '2023-10-26', amount: 31.58 }, sheetRows, 'd'), null);
});

test('rows written by this same draft (a retry after a failed sync) are not counted', () => {
  assert.equal(findReceiptInSheet({ vendor: 'Lucen LLC', date: '2026-10-12', amount: 2000 }, sheetRows, 'draft_lucen'), null);
});

test('drafts with no total, payee or date are never flagged', () => {
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '2023-10-26', amount: 0 }, sheetRows, 'd'), null);
  assert.equal(findReceiptInSheet({ vendor: '', date: '2023-10-26', amount: 156.6 }, sheetRows, 'd'), null);
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '', amount: 156.6 }, sheetRows, 'd'), null);
  assert.equal(findReceiptInSheet({ vendor: 'Home Depot', date: '2023-10-26', amount: 156.6 }, [], 'd'), null);
});
