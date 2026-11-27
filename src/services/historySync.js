import { APP_STORAGE_KEYS } from './appStorage.js';
import { canonicalPhaseName, categoryDisplayName, categoryForPhase, parseTransactions } from './sheetV2.js';

const cents = (value) => Math.round((Number(value) || 0) * 100);
const text = (value) => String(value ?? '').trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

export function getSheetTransactionsCacheKey(projectId) {
  return `jobscan_sheet_transactions_${text(projectId)}`;
}

export function loadCachedSheetTransactions(storage, projectId) {
  if (!storage || !text(projectId)) return null;
  try {
    const raw = storage.getItem(getSheetTransactionsCacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function persistCachedSheetTransactions(storage, projectId, transactions) {
  if (!storage || !text(projectId) || !Array.isArray(transactions)) return;
  try {
    storage.setItem(getSheetTransactionsCacheKey(projectId), JSON.stringify(transactions));
  } catch (err) {
    console.warn('[historySync] Could not cache Sheet transactions:', err);
  }
}

export function loadDismissedHistoryMap(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(APP_STORAGE_KEYS.dismissedHistory);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function persistDismissedHistoryMap(map, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !map || typeof map !== 'object') return;
  try {
    storage.setItem(APP_STORAGE_KEYS.dismissedHistory, JSON.stringify(map));
  } catch (err) {
    console.warn('[historySync] Could not save dismissed History map:', err);
  }
}

export function getProjectDismissScope(activeProject) {
  return text(activeProject?.id) || text(activeProject?.name) || 'default';
}

/**
 * Stable per-entry key used when hiding (`X` / `Clear All`) an entry from History on this device
 * without modifying the Google Sheet.
 */
export function getHistoryDismissKey(entry) {
  if (!entry) return '';
  const rid = text(entry.receiptId);
  if (rid) return `rid:${rid}`;
  if (typeof entry.sheetRowNumber === 'number' || typeof entry.check?.rowNumber === 'number') {
    const rowNum = entry.sheetRowNumber ?? entry.check?.rowNumber;
    return `row:${rowNum}:${text(entry.dateTransaction)}:${text(entry.vendor).toLowerCase()}:${cents(entry.amount)}`;
  }
  return `local:${text(entry.id)}`;
}

export function entryBelongsToProject(entry, activeProject) {
  if (!activeProject) return true;
  const projFolder = text(activeProject.folderId);
  const projName = text(activeProject.name);
  const entryFolder = text(entry?.folderId);
  const entryLot = text(entry?.lotName);

  if (projFolder && entryFolder) {
    return entryFolder === projFolder;
  }
  if (projName && entryLot) {
    return same(entryLot, projName);
  }
  // Legacy entries logged before multi-project tagging only match if neither folder nor lot was recorded
  return !entryFolder && !entryLot;
}

/**
 * Normalizes raw Sheet transaction rows (either 2D array from `fetchTransactionRows` or parsed objects
 * from `computeV2Dashboard`) into uniform transaction objects.
 */
export function normalizeSheetTransactions(rowsOrObjects) {
  if (!Array.isArray(rowsOrObjects) || rowsOrObjects.length === 0) return [];
  if (Array.isArray(rowsOrObjects[0])) {
    return parseTransactions(rowsOrObjects);
  }
  return rowsOrObjects
    .filter(Boolean)
    .map((t, idx) => ({
      rowNumber: Number(t.rowNumber) || idx + 2,
      date: text(t.date),
      payee: text(t.payee),
      description: text(t.description),
      category: text(t.category),
      phase: text(t.phase),
      material: Number(t.material) || 0,
      labor: Number(t.labor) || 0,
      check: text(t.check),
      receipt: text(t.receipt),
      receiptId: text(t.receiptId)
    }));
}

/**
 * Builds the active Lot's cross-device History list by combining:
 * 1. Every row in the active Lot's `Transactions` tab (newest row first, with PDF link & local check status)
 * 2. Any local-only History entry on this device for the active Lot that is not yet in `Transactions`
 *    (e.g. legacy non-v2 syncs or a `missing` warning entry)
 * Filtered by `dismissedKeys` so `X` and `Clear All` hide entries on this device without touching the Sheet.
 */
export function buildProjectHistory({
  activeProject,
  sheetTransactions = null,
  localHistory = [],
  dismissedKeys = []
} = {}) {
  const dismissedSet = new Set(Array.isArray(dismissedKeys) ? dismissedKeys : []);
  const projectLocal = (Array.isArray(localHistory) ? localHistory : []).filter(entry =>
    entryBelongsToProject(entry, activeProject)
  );

  // If no v2 Sheet transactions have been loaded yet (e.g. legacy Sheet or offline before first fetch),
  // fall back cleanly to this project's local History entries.
  if (!Array.isArray(sheetTransactions)) {
    return projectLocal.filter(entry => !dismissedSet.has(getHistoryDismissKey(entry)));
  }

  const normalizedRows = normalizeSheetTransactions(sheetTransactions);
  const localByReceiptId = new Map();
  projectLocal.forEach(entry => {
    const rid = text(entry?.receiptId);
    if (rid && !localByReceiptId.has(rid)) {
      localByReceiptId.set(rid, entry);
    }
  });

  const seenReceiptIds = new Set();
  const fromSheet = [...normalizedRows]
    .sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0))
    .map(row => {
      const rid = text(row.receiptId);
      if (rid) seenReceiptIds.add(rid);
      const localMatch = rid ? localByReceiptId.get(rid) : null;

      const hasLaborOnly = cents(row.labor) !== 0 && cents(row.material) === 0;
      const costCategory = hasLaborOnly ? 'labor' : 'material';
      const amount = hasLaborOnly
        ? row.labor
        : (cents(row.material) !== 0 && cents(row.labor) === 0
            ? row.material
            : (cents(row.material) + cents(row.labor)) / 100);

      const canonicalPhase = canonicalPhaseName(row.phase) || row.phase;
      const categoryName = categoryDisplayName(row.category) || categoryForPhase(canonicalPhase)?.name || row.category;

      const check = localMatch?.check && localMatch.check.status === 'different'
        ? localMatch.check
        : { status: 'ok', problems: [], rowNumber: row.rowNumber };

      const merged = {
        id: localMatch?.id || `sheet_${text(activeProject?.id || 'proj')}_${rid || `row_${row.rowNumber}`}`,
        receiptId: rid,
        sheetRowNumber: row.rowNumber,
        vendor: row.payee || localMatch?.vendor || 'Unknown Vendor',
        description: row.description || localMatch?.description || canonicalPhase || 'Recorded Expense',
        amount: localMatch?.check?.status === 'different' ? localMatch.amount : amount,
        costCategory: localMatch?.check?.status === 'different' ? localMatch.costCategory : costCategory,
        tradeCategory: localMatch?.check?.status === 'different' ? localMatch.tradeCategory : categoryName,
        tradePhase: localMatch?.check?.status === 'different' ? localMatch.tradePhase : canonicalPhase,
        dateTransaction: row.date || localMatch?.dateTransaction || '',
        dateLogged: localMatch?.dateLogged || row.date || 'Sheet',
        checkNumber: row.check || localMatch?.checkNumber || '',
        syncedAt: localMatch?.syncedAt || '',
        link: row.receipt || localMatch?.link || '',
        fileId: localMatch?.fileId || '',
        folderId: activeProject?.folderId || localMatch?.folderId || '',
        lotName: activeProject?.name || localMatch?.lotName || '',
        fromSheet: true,
        check
      };
      return merged;
    });

  // Keep any local entries for this project whose receiptId wasn't found in the Sheet (e.g. missing warning)
  const localUnmatched = projectLocal.filter(entry => {
    const rid = text(entry?.receiptId);
    if (!rid) return normalizedRows.length === 0;
    return !seenReceiptIds.has(rid);
  });

  return [...localUnmatched, ...fromSheet].filter(
    entry => !dismissedSet.has(getHistoryDismissKey(entry))
  );
}

/**
 * Filters History items by search query (vendor, description, category, phase, date, check #, amount)
 * and cost category ('all' | 'material' | 'labor').
 */
export function filterHistoryItems(history = [], { query = '', costFilter = 'all' } = {}) {
  const list = Array.isArray(history) ? history : [];
  const cleanQuery = String(query || '').trim().toLowerCase();

  return list.filter(item => {
    if (!item) return false;
    if (costFilter === 'material' && String(item.costCategory || '').toLowerCase() === 'labor') {
      return false;
    }
    if (costFilter === 'labor' && String(item.costCategory || '').toLowerCase() !== 'labor') {
      return false;
    }
    if (!cleanQuery) return true;

    const haystack = [
      item.vendor,
      item.description,
      item.tradeCategory ? String(item.tradeCategory).replace(/_/g, ' ') : '',
      item.tradePhase,
      item.dateTransaction,
      item.checkNumber,
      item.amount !== undefined && item.amount !== null ? String(item.amount) : ''
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(cleanQuery);
  });
}
