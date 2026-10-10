/**
 * Growing the phase sections of a new-layout Sheet's category tabs after a sync.
 *
 * Each phase block on a category tab is: a band row (column A = exact phase name), a header row,
 * the receipt area (where a FILTER spills that phase's Transactions rows), then a row whose
 * column A is `QUOTES`. When a phase has nearly as many receipts as its receipt area has rows,
 * rows are inserted just above `QUOTES` so the area has 10 spare rows again.
 * Tabs without `QUOTES` markers (older template copies) are left alone.
 * Growing never fails a sync: problems come back as a list, never as a thrown error.
 */

import { V2_CATEGORIES, V2_TABS } from './sheetV2.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const QUOTES_MARKER = 'QUOTES';
// Phase blocks start at row 6 or below; band and QUOTES rows are matched exactly (case-sensitive, trimmed)
export const FIRST_BLOCK_ROW = 6;
export const MIN_SPARE_RECEIPT_ROWS = 3;
export const TARGET_SPARE_RECEIPT_ROWS = 10;
const TRANSACTIONS_PHASE_RANGE = `${V2_TABS.transactions}!E2:E5000`;
const CATEGORY_TAB_COLUMN_A = 'A1:A2000';

function cellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function firstCell(row) {
  return cellText(Array.isArray(row) ? row[0] : row);
}

/**
 * Band row and QUOTES row (1-based) of a phase on a category tab, from its column A values.
 * null when the phase is not on the tab or has no QUOTES row below it.
 */
export function findPhaseBlock(columnA, phase) {
  const rows = Array.isArray(columnA) ? columnA : [];
  const wanted = cellText(phase);
  if (!wanted) return null;
  // Rows 1-5 are the tab title and totals; on a one-phase tab they could read like the phase name
  let bandIndex = -1;
  for (let i = FIRST_BLOCK_ROW - 1; i < rows.length; i++) {
    if (firstCell(rows[i]) === wanted) {
      bandIndex = i;
      break;
    }
  }
  if (bandIndex === -1) return null;
  for (let i = bandIndex + 1; i < rows.length; i++) {
    if (firstCell(rows[i]) === QUOTES_MARKER) {
      return { bandRow: bandIndex + 1, quotesRow: i + 1 };
    }
  }
  return null;
}

/** Number of Transactions rows per phase (Sheets matches FILTER text without case). */
export function countReceiptsByPhase(phaseColumnValues) {
  const counts = new Map();
  (Array.isArray(phaseColumnValues) ? phaseColumnValues : []).forEach(row => {
    const key = firstCell(row).toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

/**
 * Rows to insert on one category tab. Each entry: { phase, bandRow, quotesRow, receiptAreaSize,
 * receiptCount, insertCount, startIndex } with startIndex = 0-based index of the QUOTES row.
 * Sorted bottom-up so inserting in order never moves a block that is still to be grown.
 */
export function planPhaseGrowth(columnA, phases, receiptCounts) {
  const plan = [];
  (Array.isArray(phases) ? phases : []).forEach(phase => {
    const block = findPhaseBlock(columnA, phase);
    if (!block) return;
    const receiptAreaSize = block.quotesRow - (block.bandRow + 2);
    const receiptCount = receiptCounts?.get(cellText(phase).toLowerCase()) || 0;
    if (receiptAreaSize - receiptCount >= MIN_SPARE_RECEIPT_ROWS) return;
    plan.push({
      phase,
      ...block,
      receiptAreaSize,
      receiptCount,
      insertCount: receiptCount + TARGET_SPARE_RECEIPT_ROWS - receiptAreaSize,
      startIndex: block.quotesRow - 1
    });
  });
  return plan.sort((a, b) => b.startIndex - a.startIndex);
}

/** The batchUpdate body for one tab's plan. */
export function buildGrowthRequests(sheetId, plan) {
  return {
    requests: plan.map(step => ({
      insertDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: step.startIndex,
          endIndex: step.startIndex + step.insertCount
        },
        inheritFromBefore: true
      }
    }))
  };
}

async function readError(response) {
  const text = await response.text().catch(() => '');
  return text || response.statusText || String(response.status);
}

/**
 * Grows the phase sections on the category tabs that just received rows.
 * `tabs` = spreadsheet tab properties ({ sheetId, title }); `categoryNames` = category display names.
 * Returns { grown: [{ tab, phase, inserted }], errors: [string] }. Never throws.
 */
export async function growPhaseSections(accessToken, spreadsheetId, { tabs = [], categoryNames = [] } = {}) {
  const result = { grown: [], errors: [] };
  try {
    const targets = [];
    new Set(categoryNames).forEach(name => {
      const category = V2_CATEGORIES.find(c => c.name === name);
      const tab = (tabs || []).find(t => cellText(t?.title) === name);
      if (category && tab && tab.sheetId !== undefined && tab.sheetId !== null) {
        targets.push({ category, tab });
      }
    });
    if (targets.length === 0) return result;

    // One read: Transactions phases plus column A of each affected tab
    const ranges = [TRANSACTIONS_PHASE_RANGE, ...targets.map(t => `'${t.tab.title.replace(/'/g, "''")}'!${CATEGORY_TAB_COLUMN_A}`)];
    const query = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const readRes = await fetch(`${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!readRes.ok) {
      result.errors.push(`Could not read the category tabs: ${await readError(readRes)}`);
      return result;
    }
    const valueRanges = (await readRes.json()).valueRanges || [];
    const counts = countReceiptsByPhase(valueRanges[0]?.values || []);

    for (let i = 0; i < targets.length; i++) {
      const { category, tab } = targets[i];
      const plan = planPhaseGrowth(valueRanges[i + 1]?.values || [], category.phases, counts);
      if (plan.length === 0) continue;
      try {
        const res = await fetch(`${GOOGLE_SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildGrowthRequests(tab.sheetId, plan))
        });
        if (!res.ok) {
          result.errors.push(`Could not add rows on "${tab.title}": ${await readError(res)}`);
          continue;
        }
        plan.forEach(step => result.grown.push({ tab: tab.title, phase: step.phase, inserted: step.insertCount }));
      } catch (err) {
        result.errors.push(`Could not add rows on "${tab.title}": ${err?.message || err}`);
      }
    }
  } catch (err) {
    result.errors.push(`Could not check the phase sections: ${err?.message || err}`);
  }
  return result;
}
