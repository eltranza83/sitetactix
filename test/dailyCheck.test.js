import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildHistoryLogs, buildSplitMetadata } from '../src/services/invoiceUpload.js';
import { buildAutoSplits } from '../src/services/editFormHelpers.js';
import { buildTransactionRow, parseTransactions } from '../src/services/sheetV2.js';
import {
  buildDailyCheck,
  checkSyncedEntries,
  parseSheetDashboardTotals
} from '../src/services/dailyCheck.js';

const NOW = new Date(2026, 9, 11, 20, 0, 0); // Oct 11, 8 PM local
const TODAY = new Date(2026, 9, 11, 9, 30, 0).toISOString();
const YESTERDAY = new Date(2026, 9, 10, 16, 0, 0).toISOString();
const LOT = 'Lot 99 - Testingv2';
const HEADER = ['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check / Payment', 'Receipt', 'Receipt ID'];

const lucenCheck = {
  vendor: 'Lucen LLC', amount: 2000, costCategory: 'labor', checkNumber: '1545', date: '2026-10-11',
  description: 'Electrical labor', lotNumber: LOT, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting'
};
const homeDepot = {
  vendor: 'Home Depot', amount: 156.60, costCategory: 'material', date: '2023-10-26', description: 'Supplies', lotNumber: LOT,
  tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In',
  lineItems: [
    { description: 'PVC', price: 94, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
    { description: 'SWITCH', price: 18.6, tradeCategory: 'Interior_Hardware', tradePhase: 'Electrical Hardware Fixtures' },
    { description: 'SCREWS', price: 32, tradeCategory: 'Framing_&_Lumber', tradePhase: 'Framing Lumber & Truss' }
  ]
};
homeDepot.splits = buildAutoSplits(homeDepot);

/** What a sync writes: the History entries and the Transactions rows, using the app's own code. */
function sync(draftId, metadata, syncedAt = TODAY) {
  const logs = buildHistoryLogs(metadata, { idPrefix: `file_${draftId}`, link: 'https://drive/x', draftId, syncedAt });
  const rows = metadata.splits
    ? metadata.splits.map((split, i) => {
      const m = buildSplitMetadata(metadata, split, draftId, i);
      return buildTransactionRow(m, { receiptId: m.receiptId });
    })
    : [buildTransactionRow({ ...metadata, receiptId: `${draftId}` }, { receiptId: draftId })];
  return { logs, rows };
}

const a = sync('draft_a', lucenCheck);
const b = sync('draft_b', homeDepot);
const old = sync('draft_old', { ...lucenCheck, checkNumber: '1050', date: '2026-10-09' }, YESTERDAY);
const ALL_ROWS = [HEADER, ...old.rows, ...a.rows, ...b.rows];
const HISTORY = [...b.logs, ...a.logs, ...old.logs];
const appTotals = { totalSpent: 4156.6 };

const check = (overrides = {}) => buildDailyCheck({
  history: HISTORY,
  transactions: parseTransactions(ALL_ROWS),
  drafts: [],
  projectName: LOT,
  appTotals,
  now: NOW,
  ...overrides
});

describe('automatic check after each sync', () => {
  test('every synced entry finds its own row and matches it', () => {
    const checked = checkSyncedEntries([...a.logs, ...b.logs], ALL_ROWS);
    assert.equal(checked.length, 4);
    checked.forEach(log => assert.equal(log.check.status, 'ok', `${log.vendor} ${log.amount}`));
    assert.equal(checked[0].check.rowNumber, 3);
  });

  test('a row that never landed is reported as missing', () => {
    const rows = ALL_ROWS.filter(r => r[9] !== 'draft_a');
    const [log] = checkSyncedEntries(a.logs, rows);
    assert.equal(log.check.status, 'missing');
  });

  test('a row that landed with a different phase or amount is reported with what differs', () => {
    const rows = ALL_ROWS.map(r => (r[9] === 'draft_a' ? [...r.slice(0, 4), 'Plumbing Rough-In', '', 200, ...r.slice(7)] : r));
    const [log] = checkSyncedEntries(a.logs, rows);
    assert.equal(log.check.status, 'different');
    assert.deepEqual(log.check.problems, [
      'Phase is "Plumbing Rough-In", expected "Electrical & Lighting"',
      'Labor is $200.00, expected $2,000.00'
    ]);
  });

  test('older History entries without a Receipt ID are left alone', () => {
    const untracked = buildHistoryLogs(lucenCheck, { idPrefix: 'old', link: null });
    assert.deepEqual(checkSyncedEntries(untracked, ALL_ROWS), untracked);
  });
});

describe('Today card on the Dashboard', () => {
  test('counts only today\'s entries for this house, all recorded', () => {
    const result = check();
    assert.equal(result.count, 4);
    assert.equal(result.total, 2156.6);
    assert.equal(result.ok, true);
    assert.equal(result.problemCount, 0);
  });

  test('entries for another lot and from yesterday are not counted', () => {
    const otherLot = sync('draft_c', { ...lucenCheck, lotNumber: 'Lot 3', amount: 500 });
    const result = check({ history: [...otherLot.logs, ...HISTORY] });
    assert.equal(result.count, 4);
  });

  test('a missing row turns the card red', () => {
    const result = check({ transactions: parseTransactions(ALL_ROWS.filter(r => r[9] !== 'draft_b_split_1')) });
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].log.tradePhase, 'Electrical Hardware Fixtures');
  });

  test('drafts still waiting for this house are counted (not a problem by themselves)', () => {
    const result = check({ drafts: [{ metadata: { lotNumber: LOT } }, { metadata: { lotNumber: 'Lot 3' } }, { metadata: {} }] });
    assert.equal(result.draftsWaiting, 2);
    assert.equal(result.ok, true);
  });

  test('the same check scanned twice is flagged as a possible duplicate', () => {
    const again = sync('draft_dup', lucenCheck);
    const rows = [...ALL_ROWS, ...again.rows];
    const result = check({ history: [...again.logs, ...HISTORY], transactions: parseTransactions(rows) });
    assert.equal(result.duplicates.length, 1);
    assert.deepEqual(result.duplicates[0].rows, [3, 7]);
    assert.equal(result.ok, false);
  });

  test('splits of the same receipt are never called duplicates of each other', () => {
    const twin = { ...homeDepot, splits: homeDepot.splits.map(s => ({ ...s, amount: 50 })), amount: 150 };
    const t = sync('draft_twin', twin);
    const result = check({ history: [...t.logs], transactions: parseTransactions([HEADER, ...t.rows]), appTotals: { totalSpent: 150 } });
    assert.equal(result.duplicates.length, 0);
  });

  test('the Sheet\'s own Dashboard total is compared with the app\'s', () => {
    const sheetRows = [['', 'Budget', '', '', '', '', 'Spent to date', '', '', 4156.6], ['', '', '', '', '', '', 'Still owed to subs', '', '', 11000]];
    const totals = parseSheetDashboardTotals(sheetRows);
    assert.deepEqual(totals, { spent: 4156.6, owed: 11000 });
    assert.equal(check({ sheetTotals: totals }).totalsMatch, true);
    assert.equal(check({ sheetTotals: { spent: 3000, owed: 11000 } }).totalsMatch, false);
    assert.equal(check({ sheetTotals: { spent: 3000, owed: 11000 } }).ok, false);
    assert.equal(parseSheetDashboardTotals([['Something else', 5]]), null);
  });
});

describe('reading the Sheet Dashboard tab', () => {
  test('finds "Spent to date" when its note shares the cell on a second line', () => {
    const rows = [
      ['', 'Budget for build\nHard costs', '', '', '', 240000, '', 'Spent to date\nAll receipts synced', '', 4497.07],
      ['', '', '', '', '', '', '', 'Still owed to subs\nQuotes - labor paid', '', 11000]
    ];
    assert.deepEqual(parseSheetDashboardTotals(rows), { spent: 4497.07, owed: 11000 });
  });

  test('extra spaces in the label do not matter', () => {
    assert.deepEqual(parseSheetDashboardTotals([['Spent  to date ', 10]]), { spent: 10, owed: null });
  });
});

describe('Scanning into card (History only)', () => {
  const now = new Date('2026-10-15T15:00:00');
  const log = (over) => ({ lotName: 'Lot 99 -New Test', vendor: 'Home Depot', amount: 10, dateTransaction: '2026-10-15', syncedAt: '2026-10-15T14:00:00', ...over });

  test('shows the newest receipt for this house with its Sheet check, and today\'s count and total', async () => {
    const { summarizeScanTarget } = await import('../src/services/dailyCheck.js');
    const result = summarizeScanTarget([
      log({ vendor: 'Lowes', amount: 20.5, syncedAt: '2026-10-15T09:00:00', check: { status: 'ok' } }),
      log({ vendor: 'Home Depot', amount: 156.6, syncedAt: '2026-10-15T14:30:00', check: { status: 'ok' } }),
      log({ vendor: 'Old', amount: 5, syncedAt: '2026-10-12T10:00:00' }),
      log({ lotName: 'Lot 3', vendor: 'Other house', amount: 999, syncedAt: '2026-10-15T14:59:00' })
    ], 'lot 99 -new test', now);

    assert.deepEqual(result.last, { vendor: 'Home Depot', amount: 156.6, date: '2026-10-15', status: 'ok' });
    assert.equal(result.todayCount, 2);
    assert.equal(result.todayTotal, 177.1);
  });

  test('another house\'s receipt or an entry with no house is never shown', async () => {
    const { summarizeScanTarget } = await import('../src/services/dailyCheck.js');
    const result = summarizeScanTarget([log({ lotName: 'Lot 3' }), log({ lotName: '' })], 'Lot 99 -New Test', now);
    assert.equal(result.last, null);
    assert.equal(result.todayCount, 0);
  });

  test('a receipt the Sheet check could not find is reported, unchecked ones say so', async () => {
    const { summarizeScanTarget } = await import('../src/services/dailyCheck.js');
    assert.equal(summarizeScanTarget([log({ check: { status: 'missing' } })], 'Lot 99 -New Test', now).last.status, 'missing');
    assert.equal(summarizeScanTarget([log({})], 'Lot 99 -New Test', now).last.status, 'unchecked');
    assert.equal(summarizeScanTarget([], '', now).last, null);
  });
});
