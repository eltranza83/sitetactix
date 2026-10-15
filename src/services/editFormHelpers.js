import { TRADE_CATEGORIES } from '../config/tradeCategories.js';

/** Category key -> { label, phases }, in Sheet order (from the shared list). */
export const TRADE_SECTIONS_CONFIG = Object.fromEntries(
  TRADE_CATEGORIES.map(({ key, name, phases }) => [key, { label: name, phases }])
);

export function isValidPhase(category, phase) {
  if (!category || !phase) return false;
  const config = TRADE_SECTIONS_CONFIG[category];
  if (!config || !Array.isArray(config.phases)) return false;
  return config.phases.includes(phase);
}

export function isDraftPhaseValid(metadata) {
  if (!metadata) return false;
  if (Array.isArray(metadata.splits) && metadata.splits.length > 0) {
    return metadata.splits.every(split => isValidPhase(split.tradeCategory || metadata.tradeCategory, split.tradePhase));
  }
  return isValidPhase(metadata.tradeCategory, metadata.tradePhase);
}

export function distributeReceiptTotalToSplits(splitBaseAmounts, receiptTotal) {
  if (!Array.isArray(splitBaseAmounts) || splitBaseAmounts.length === 0) {
    return [];
  }

  const receiptCents = Math.round((parseFloat(receiptTotal) || 0) * 100);
  const baseCents = splitBaseAmounts.map(amt => Math.max(0, Math.round((parseFloat(amt) || 0) * 100)));
  const totalBaseCents = baseCents.reduce((sum, c) => sum + c, 0);

  if (totalBaseCents === 0) {
    if (receiptCents === 0) {
      return baseCents.map(() => '0.00');
    }
    const equalShare = Math.floor(receiptCents / baseCents.length);
    let remainder = receiptCents % baseCents.length;
    return baseCents.map(() => {
      const share = equalShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      return (share / 100).toFixed(2);
    });
  }

  const diffCents = receiptCents - totalBaseCents;

  const resultCents = baseCents.map(base => {
    const proportionalDiff = Math.round(diffCents * (base / totalBaseCents));
    return base + proportionalDiff;
  });

  const allocatedTotal = resultCents.reduce((sum, c) => sum + c, 0);
  const leftoverCents = receiptCents - allocatedTotal;

  if (leftoverCents !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < baseCents.length; i++) {
      if (baseCents[i] > baseCents[largestIdx]) {
        largestIdx = i;
      }
    }
    resultCents[largestIdx] += leftoverCents;
  }

  return resultCents.map(cents => (cents / 100).toFixed(2));
}

export function checkLineItemsDiscrepancy(lineItemsTotal, receiptTotal, thresholdRatio = 0.15) {
  const lineTotalNum = parseFloat(lineItemsTotal) || 0;
  const receiptTotalNum = parseFloat(receiptTotal) || 0;
  if (receiptTotalNum <= 0 || lineTotalNum <= 0) {
    return { isDiscrepant: false, lineItemsTotal: lineTotalNum, receiptTotal: receiptTotalNum, diff: 0 };
  }
  const diff = Math.abs(receiptTotalNum - lineTotalNum);
  const threshold = receiptTotalNum * thresholdRatio;
  return {
    isDiscrepant: diff > threshold,
    lineItemsTotal: lineTotalNum,
    receiptTotal: receiptTotalNum,
    diff
  };
}

export const ALLOCATION_COLORS = [
  { text: '#F1D7A7', border: '#F1D7A7', bg: 'rgba(241, 215, 167, 0.12)', darkBg: 'rgba(241, 215, 167, 0.04)' },
  { text: '#38bdf8', border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', darkBg: 'rgba(56, 189, 248, 0.04)' },
  { text: '#34d399', border: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', darkBg: 'rgba(52, 211, 153, 0.04)' },
  { text: '#c084fc', border: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', darkBg: 'rgba(192, 132, 252, 0.04)' }
];

function isValidTrade(category, phase) {
  return !!TRADE_SECTIONS_CONFIG[category]?.phases.includes(phase);
}

/**
 * Groups the scanned line items by the category and phase the scanner gave each one.
 * An item with no (or an invalid) trade of its own takes the receipt's main trade.
 * Groups come back in the order they first appear: [{ tradeCategory, tradePhase, itemIndexes }].
 */
export function planSplitsFromLineItems(lineItems, mainTrade) {
  if (!Array.isArray(lineItems)) return [];
  const groups = [];
  lineItems.forEach((item, idx) => {
    const own = item && isValidTrade(item.tradeCategory, item.tradePhase)
      ? { tradeCategory: item.tradeCategory, tradePhase: item.tradePhase }
      : mainTrade;
    if (!own || !own.tradeCategory || !own.tradePhase) return;
    let group = groups.find(g => g.tradeCategory === own.tradeCategory && g.tradePhase === own.tradePhase);
    if (!group) {
      group = { tradeCategory: own.tradeCategory, tradePhase: own.tradePhase, itemIndexes: [] };
      groups.push(group);
    }
    group.itemIndexes.push(idx);
  });
  return groups;
}

/**
 * The split an item belongs to: the one with the same category and phase the scanner gave it,
 * otherwise the first split.
 */
export function pickSplitForItem(item, splits) {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  const match = item && splits.find(s => s.tradeCategory === item.tradeCategory && s.tradePhase === item.tradePhase);
  return (match || splits[0]).id;
}

/**
 * When the scan found items in two or more different categories, builds the splits right away
 * (same lot as the receipt, amounts spread so they add up to the receipt total).
 * Returns null for a receipt that needs no split.
 */
export function buildAutoSplits(metadata) {
  const lineItems = Array.isArray(metadata?.lineItems) ? metadata.lineItems : [];
  const mainTrade = { tradeCategory: metadata?.tradeCategory, tradePhase: metadata?.tradePhase };
  const groups = planSplitsFromLineItems(lineItems, mainTrade);
  if (groups.length < 2) return null;

  const baseSums = groups.map(g => g.itemIndexes.reduce((sum, idx) => sum + (parseFloat(lineItems[idx].price) || 0), 0));
  const amounts = distributeReceiptTotalToSplits(baseSums, metadata.amount);

  return groups.map((group, i) => ({
    id: `split_auto_${i + 1}`,
    amount: parseFloat(amounts[i]) || 0,
    costCategory: metadata.costCategory || 'material',
    lotNumber: metadata.lotNumber || '',
    description: group.itemIndexes.map(idx => lineItems[idx].description).join(', '),
    tradeCategory: group.tradeCategory,
    tradePhase: group.tradePhase,
    itemIndexes: group.itemIndexes,
    items: group.itemIndexes.map(idx => lineItems[idx])
  }));
}

/** Positions (in the scanned line items) of the items assigned to one split. */
export function getItemIndexesForSplit(lineItems, itemAllocations, splitId) {
  if (!Array.isArray(lineItems) || !itemAllocations) return [];
  return lineItems.map((_, idx) => idx).filter(idx => itemAllocations[idx] === splitId);
}

/**
 * The scanned line items (with SKUs) assigned to one split,
 * so each split's PDF lists only its own items.
 */
export function getItemsForSplit(lineItems, itemAllocations, splitId) {
  if (!Array.isArray(lineItems) || !itemAllocations) return [];
  return lineItems.filter((_, idx) => itemAllocations[idx] === splitId);
}

/**
 * Spreads the receipt total over the splits by the prices of the items assigned to each one,
 * and lists those items as each split's description. Amounts or descriptions the user typed
 * by hand (manualAmounts / manualDescriptions, keyed by split id) are kept.
 * Returns the same array when nothing changed.
 */
export function recalculateSplits(splits, lineItems, itemAllocations, receiptTotal, { manualAmounts = {}, manualDescriptions = {} } = {}) {
  const itemsPerSplit = splits.map(s => getItemsForSplit(lineItems || [], itemAllocations, s.id));
  const baseSums = itemsPerSplit.map(items => items.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0));
  const distributed = distributeReceiptTotalToSplits(baseSums, parseFloat(receiptTotal) || 0);

  let changed = false;
  const updated = splits.map((s, i) => {
    const amount = manualAmounts[s.id] ? s.amount : (distributed[i] || '');
    const description = manualDescriptions[s.id] ? s.description : itemsPerSplit[i].map(item => item.description).join(', ');
    if (amount === s.amount && description === s.description) return s;
    changed = true;
    return { ...s, amount, description };
  });
  return changed ? updated : splits;
}

/**
 * Turns a scanned date into YYYY-MM-DD, which is what the date box needs.
 * Accepts 2026-02-01, 02/01/2026, 2/1/26 and 02-01-2026 (month first, as on US receipts;
 * a first number above 12 is read as the day). Returns '' when the text is not a real date.
 */
export function normalizeScanDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  let year;
  let month;
  let day;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const us = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (us) {
    let first = Number(us[1]);
    let second = Number(us[2]);
    year = Number(us[3]);
    if (us[3].length === 2) year += 2000;
    if (first > 12 && second <= 12) [first, second] = [second, first];
    month = first;
    day = second;
  } else {
    return '';
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
