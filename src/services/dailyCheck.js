/**
 * The automatic check that everything synced really landed in the Sheet.
 *
 * Runs right after each sync (one receipt or Sync All) and again whenever the Dashboard loads.
 * Every synced History entry carries the Receipt ID of its Transactions row, so the check can find
 * that exact row and compare it with what was synced: payee, category, phase, material and labor.
 * No AI: it is a plain comparison, so the answer is exact.
 */
import { buildTransactionRow, parseTransactions } from './sheetV2.js';
import { formatMoney as money } from './money.js';
import { normalizeScanDate } from './editFormHelpers.js';

const cents = (value) => Math.round((Number(value) || 0) * 100);
const text = (value) => String(value ?? '').trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

/** Entries synced with tracking (newer History entries, returns included); older entries have no Receipt ID to look up. */
export function isTrackedEntry(log) {
  return Boolean(log?.receiptId) && cents(log.amount) !== 0;
}

/** The Transactions row a History entry should have produced. */
export function expectedRowFor(log) {
  const row = buildTransactionRow({
    vendor: log.vendor,
    amount: log.amount,
    costCategory: log.costCategory,
    tradeCategory: log.tradeCategory,
    tradePhase: log.tradePhase,
    date: log.dateTransaction
  }, { receiptId: log.receiptId });
  // The Sheet keeps text typed as 'value (a leading apostrophe) without the apostrophe
  const asStored = (value) => text(value).replace(/^'/, '');
  return {
    payee: asStored(row[1]),
    category: asStored(row[3]),
    phase: asStored(row[4]),
    material: row[5] === '' ? 0 : Number(row[5]),
    labor: row[6] === '' ? 0 : Number(row[6])
  };
}


/**
 * Compares one synced entry with its row. Result status:
 * 'ok' (row found and matches), 'missing' (no row with its Receipt ID), 'different' (row found, something differs).
 */
export function checkEntry(log, rowsByReceiptId) {
  const row = rowsByReceiptId.get(text(log.receiptId));
  if (!row) return { status: 'missing', problems: ['Not found in the Transactions tab'] };

  const expected = expectedRowFor(log);
  const problems = [];
  if (!same(row.payee, expected.payee)) problems.push(`Payee is "${row.payee}", expected "${expected.payee}"`);
  if (!same(row.category, expected.category)) problems.push(`Category is "${row.category}", expected "${expected.category}"`);
  if (!same(row.phase, expected.phase)) problems.push(`Phase is "${row.phase}", expected "${expected.phase}"`);
  if (cents(row.material) !== cents(expected.material)) problems.push(`Material is ${money(row.material)}, expected ${money(expected.material)}`);
  if (cents(row.labor) !== cents(expected.labor)) problems.push(`Labor is ${money(row.labor)}, expected ${money(expected.labor)}`);
  return { status: problems.length ? 'different' : 'ok', problems, rowNumber: row.rowNumber };
}

export function indexByReceiptId(transactions) {
  const map = new Map();
  (transactions || []).forEach(t => { if (t.receiptId) map.set(text(t.receiptId), t); });
  return map;
}

/** Adds a `check` result to each tracked entry, from Transactions rows as read from the Sheet (row 1 = headers). */
export function checkSyncedEntries(logs, transactionRows, checkedAt = new Date().toISOString()) {
  const byId = indexByReceiptId(parseTransactions(transactionRows));
  return (logs || []).map(log => (isTrackedEntry(log)
    ? { ...log, check: { ...checkEntry(log, byId), checkedAt } }
    : log));
}

function sameLocalDay(iso, now) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return false;
  return when.getFullYear() === now.getFullYear()
    && when.getMonth() === now.getMonth()
    && when.getDate() === now.getDate();
}

function belongsToProject(lotName, projectName) {
  return !text(lotName) || !text(projectName) || same(lotName, projectName);
}

const draftBase = (receiptId) => text(receiptId).replace(/_split_\d+$/, '');

/**
 * The scan screen's "Scanning into" card: this house's last synced receipt (and whether reading the
 * Sheet back after sync found it), and what was synced for it today. History only: no Google call.
 * Status: 'ok' | 'missing' | 'different' | 'unchecked' (older entries or a check that could not run).
 */
export function summarizeScanTarget(history = [], projectName = '', now = new Date()) {
  const mine = (history || []).filter(log => text(projectName) && same(log?.lotName, projectName) && cents(log?.amount) !== 0);
  const last = mine.reduce((latest, log) => (!latest || text(log.syncedAt) > text(latest.syncedAt) ? log : latest), null);
  const today = mine.filter(log => sameLocalDay(log.syncedAt, now));
  return {
    last: last ? {
      vendor: text(last.vendor) || 'Receipt',
      amount: cents(last.amount) / 100,
      date: text(last.dateTransaction),
      status: last.check?.status || 'unchecked'
    } : null,
    todayCount: today.length,
    todayTotal: today.reduce((sum, log) => sum + cents(log.amount), 0) / 100
  };
}

/** Other rows with the same payee, date and total as a row synced today (a receipt or check scanned twice). */
export function findPossibleDuplicates(transactions, todaysReceiptIds) {
  const rows = transactions || [];
  const found = [];
  const seen = new Set();
  rows.filter(r => todaysReceiptIds.has(text(r.receiptId))).forEach(row => {
    const total = cents(row.material) + cents(row.labor);
    rows.forEach(other => {
      if (other === row || draftBase(other.receiptId) === draftBase(row.receiptId)) return;
      if (!same(other.payee, row.payee) || text(other.date) !== text(row.date)) return;
      if (cents(other.material) + cents(other.labor) !== total) return;
      const key = [row.rowNumber, other.rowNumber].sort((a, b) => a - b).join('-');
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ payee: row.payee, date: row.date, amount: total / 100, rows: [row.rowNumber, other.rowNumber].sort((a, b) => a - b) });
    });
  });
  return found;
}

/**
 * Before a sync: is this receipt already in the Sheet? Looks for rows with the same payee, the same date
 * and the same total as the draft. Rows of one earlier receipt (its splits) are added up together, so a
 * receipt synced before as 4 splits is still found. Rows this same draft wrote are never counted.
 * Returns { payee, date, amount, rows } for the first match, or null.
 */
export function findReceiptInSheet(metadata, transactions, draftId = '') {
  const splits = Array.isArray(metadata?.splits) && metadata.splits.length > 0 ? metadata.splits : null;
  const totalCents = splits
    ? splits.reduce((sum, s) => sum + cents(s.amount), 0)
    : cents(metadata?.amount);
  if (totalCents === 0) return null;

  const firstRow = buildTransactionRow(metadata || {});
  const payee = text(firstRow[1]).replace(/^'/, '');
  const date = normalizeScanDate(text(firstRow[0]).replace(/^'/, ''));
  if (!payee || !date) return null;

  const groups = new Map();
  (transactions || []).forEach(row => {
    if (!same(row.payee, payee) || normalizeScanDate(row.date) !== date) return;
    const base = draftBase(row.receiptId);
    if (draftId && base === text(draftId)) return;
    const key = base || `row ${row.rowNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  for (const rows of groups.values()) {
    const groupCents = rows.reduce((sum, r) => sum + cents(r.material) + cents(r.labor), 0);
    if (groupCents === totalCents) {
      return { payee, date, amount: totalCents / 100, rows: rows.map(r => r.rowNumber).sort((a, b) => a - b) };
    }
  }
  return null;
}

/** "Home Depot $156.60 on 2023-10-26 is already in the Sheet (rows 2-5)." */
export function describeSheetMatch(match) {
  if (!match) return '';
  const rows = match.rows;
  const where = rows.length === 1
    ? `row ${rows[0]}`
    : (rows.every((r, i) => i === 0 || r === rows[i - 1] + 1) ? `rows ${rows[0]}-${rows[rows.length - 1]}` : `rows ${rows.join(', ')}`);
  return `${match.payee} ${money(match.amount)} on ${match.date} is already in the Sheet (${where}).`;
}

/** The Sheet's own Dashboard numbers, found by their labels ("Spent to date", "Still owed to subs"). */
export function parseSheetDashboardTotals(rows) {
  // A label cell can hold a second line ("Spent to date" + "All receipts synced"): match on its first line
  const firstLine = (cell) => text(cell).split(/\r?\n/)[0].replace(/\s+/g, ' ');
  const valueAfterLabel = (label) => {
    for (const row of rows || []) {
      if (!Array.isArray(row)) continue;
      const at = row.findIndex(cell => same(firstLine(cell), label));
      if (at === -1) continue;
      const numbers = row.slice(at + 1).filter(cell => typeof cell === 'number');
      if (numbers.length) return numbers[numbers.length - 1];
    }
    return null;
  };
  const spent = valueAfterLabel('Spent to date');
  const owed = valueAfterLabel('Still owed to subs');
  return spent === null && owed === null ? null : { spent, owed };
}

/**
 * Today's check for one house: everything synced today on this device, matched against the Sheet.
 * `transactions` are parsed rows; `sheetTotals` are the Sheet Dashboard's own numbers (null if not read).
 */
export function buildDailyCheck({ history = [], transactions = [], drafts = [], projectName = '', appTotals = {}, sheetTotals = null, now = new Date() } = {}) {
  const byId = indexByReceiptId(transactions);
  const entries = history
    .filter(log => isTrackedEntry(log) && sameLocalDay(log.syncedAt, now) && belongsToProject(log.lotName, projectName))
    .map(log => ({ log, ...checkEntry(log, byId) }));

  const missing = entries.filter(e => e.status === 'missing');
  const different = entries.filter(e => e.status === 'different');
  const draftsWaiting = drafts.filter(d => belongsToProject(d?.metadata?.lotNumber, projectName)).length;
  const duplicates = findPossibleDuplicates(transactions, new Set(entries.map(e => text(e.log.receiptId))));

  // Spent only: the Sheet and the app may treat an overpaid sub differently in "still owed"
  let totalsMatch = null;
  if (sheetTotals && typeof sheetTotals.spent === 'number') {
    totalsMatch = cents(sheetTotals.spent) === cents(appTotals.totalSpent);
  }

  const problemCount = missing.length + different.length + duplicates.length + (totalsMatch === false ? 1 : 0);
  return {
    entries,
    count: entries.length,
    total: entries.reduce((sum, e) => sum + cents(e.log.amount), 0) / 100,
    missing,
    different,
    draftsWaiting,
    duplicates,
    totalsMatch,
    sheetTotals,
    problemCount,
    ok: problemCount === 0
  };
}
