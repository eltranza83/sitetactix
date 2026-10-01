import { purchasingService, PURCHASING_STATUSES } from '../../purchasingService.js';

const VALID_TRADES = ['quartz', 'electrical', 'plumbing'];

export function normalizeTrade(trade = '') {
  if (!trade) return null;
  const t = String(trade).toLowerCase().trim();
  if (t === 'electrical' || t === 'electricista' || t === 'eletricista' || t === 'electricidad') return 'electrical';
  if (t === 'plumbing' || t === 'plomero' || t === 'plomeria' || t === 'plomería') return 'plumbing';
  if (t === 'quartz' || t === 'cuarzo') return 'quartz';
  return t;
}

/**
 * Normalizes item names for fuzzy matching and speech slip resolution.
 */
function normalizeItemName(name = '') {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

function findMatchingItems(allItems = [], searchName = '', tradeFilter = null) {
  const normSearch = normalizeItemName(searchName);
  const searchTokens = normSearch.split(/\s+/).filter(t => t.length > 2);
  const normTrade = normalizeTrade(tradeFilter);

  let pool = allItems;
  if (normTrade && VALID_TRADES.includes(normTrade)) {
    pool = pool.filter(it => it.categoryId === normTrade);
  }

  // 1. Exact match
  const exact = pool.filter(it => normalizeItemName(it.itemName) === normSearch);
  if (exact.length === 1) return exact;

  // 2. Contains match
  const contains = pool.filter(it => {
    const itNorm = normalizeItemName(it.itemName);
    return itNorm.includes(normSearch) || normSearch.includes(itNorm);
  });
  if (contains.length === 1) return contains;

  // 3. Token overlap match
  if (searchTokens.length > 0) {
    const tokenMatches = pool.filter(it => {
      const itNorm = normalizeItemName(it.itemName);
      return searchTokens.every(t => itNorm.includes(t));
    });
    if (tokenMatches.length > 0) return tokenMatches;

    const partialMatches = pool.filter(it => {
      const itNorm = normalizeItemName(it.itemName);
      return searchTokens.some(t => itNorm.includes(t));
    });
    if (partialMatches.length > 0) return partialMatches;
  }

  return contains;
}

export async function get_purchasing_list(args = {}, context = {}) {
  const projectId = context.projectId;
  if (!projectId) {
    return { ok: false, error: 'missing_project', message: 'Project ID is required.' };
  }
  const trade = normalizeTrade(args.trade);
  const onlyNeeded = args.onlyNeeded === true;

  const items = await purchasingService.getItems(projectId, {
    category: trade,
    status: onlyNeeded ? PURCHASING_STATUSES.NEEDED : null
  });

  const formattedItems = items.map(it => ({
    id: it.id,
    item: it.itemName,
    trade: it.categoryId,
    quantity: it.quantity || 1,
    status: it.status || PURCHASING_STATUSES.NEEDED,
    isPurchased: it.status === PURCHASING_STATUSES.PURCHASED
  }));

  return {
    ok: true,
    data: {
      trade: trade || 'all',
      total: formattedItems.length,
      neededCount: formattedItems.filter(i => !i.isPurchased).length,
      purchasedCount: formattedItems.filter(i => i.isPurchased).length,
      items: formattedItems
    }
  };
}

export async function add_purchasing_item(args = {}, context = {}) {
  const projectId = context.projectId;
  if (!projectId) {
    return { ok: false, error: 'missing_project', message: 'Project ID is required.' };
  }
  const rawItem = String(args.item || '').trim();
  const quantity = Number(args.quantity) || 1;
  const rawTrade = normalizeTrade(args.trade);

  if (!rawItem) {
    return {
      ok: false,
      error: 'missing_item',
      message: 'Item name is required to add to the purchasing list.'
    };
  }

  if (!rawTrade || !VALID_TRADES.includes(rawTrade)) {
    return {
      ok: false,
      needs: 'trade',
      options: VALID_TRADES,
      message: `Which trade purchasing list should I add "${rawItem}" to: quartz, electrical, or plumbing?`
    };
  }

  const result = await purchasingService.addItem(projectId, rawItem, quantity, rawTrade);

  if (result.action === 'ALREADY_EXISTS') {
    return {
      ok: true,
      alreadyExists: true,
      item: result.item?.itemName || rawItem,
      message: `"${result.item?.itemName || rawItem}" is already on the ${rawTrade} purchasing list.`
    };
  }

  if (!result.success) {
    return {
      ok: false,
      error: result.error || 'save_failed',
      message: result.message || `Could not add "${rawItem}" to the purchasing list.`
    };
  }

  return {
    ok: true,
    added: true,
    item: result.item?.itemName || rawItem,
    trade: rawTrade,
    quantity,
    message: `Added ${quantity > 1 ? `${quantity} ` : ''}"${result.item?.itemName || rawItem}" to the ${rawTrade} purchasing list.`
  };
}

export async function set_purchasing_status(args = {}, context = {}) {
  const projectId = context.projectId;
  if (!projectId) {
    return { ok: false, error: 'missing_project', message: 'Project ID is required.' };
  }
  const rawItem = String(args.item || '').trim();
  const tradeFilter = normalizeTrade(args.trade);
  const targetStatus = String(args.status || 'purchased').toLowerCase() === 'needed' 
    ? PURCHASING_STATUSES.NEEDED 
    : PURCHASING_STATUSES.PURCHASED;

  if (!rawItem) {
    return {
      ok: false,
      error: 'missing_item',
      message: 'Item name is required to update purchasing status.'
    };
  }

  const allItems = await purchasingService.getItems(projectId, {});
  const matches = findMatchingItems(allItems, rawItem, tradeFilter);

  if (matches.length === 0) {
    return {
      ok: false,
      notFound: true,
      message: `I couldn't find "${rawItem}" on the purchasing checklist.`
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      candidates: matches.map(m => m.itemName),
      message: `Did you mean ${matches.map(m => `"${m.itemName}"`).join(' or ')}?`
    };
  }

  const matchedItem = matches[0];
  const updateRes = await purchasingService.updateItemStatus(projectId, matchedItem.id, targetStatus);
  if (!updateRes || updateRes.success === false) {
    return {
      ok: false,
      error: 'update_failed',
      message: updateRes?.message || `Failed to update status for "${matchedItem.itemName}".`
    };
  }

  return {
    ok: true,
    updated: true,
    item: matchedItem.itemName,
    trade: matchedItem.categoryId,
    status: targetStatus,
    message: `Marked "${matchedItem.itemName}" as ${targetStatus}.`
  };
}

export async function remove_purchasing_item(args = {}, context = {}) {
  const projectId = context.projectId;
  if (!projectId) {
    return { ok: false, error: 'missing_project', message: 'Project ID is required.' };
  }
  const rawItem = String(args.item || '').trim();
  const tradeFilter = normalizeTrade(args.trade);

  if (!rawItem) {
    return {
      ok: false,
      error: 'missing_item',
      message: 'Item name is required to remove from the purchasing list.'
    };
  }

  const allItems = await purchasingService.getItems(projectId, {});
  const matches = findMatchingItems(allItems, rawItem, tradeFilter);

  if (matches.length === 0) {
    return {
      ok: false,
      notFound: true,
      message: `I couldn't find "${rawItem}" on the purchasing list to remove.`
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      candidates: matches.map(m => m.itemName),
      message: `Which item did you mean to remove: ${matches.map(m => `"${m.itemName}"`).join(' or ')}?`
    };
  }

  const matchedItem = matches[0];
  const removeRes = await purchasingService.removeItem(projectId, matchedItem.id, matchedItem.categoryId);
  if (!removeRes || removeRes.success === false) {
    return {
      ok: false,
      error: 'remove_failed',
      message: removeRes?.message || `Failed to remove "${matchedItem.itemName}".`
    };
  }

  return {
    ok: true,
    removed: true,
    item: matchedItem.itemName,
    trade: matchedItem.categoryId,
    message: `Removed "${matchedItem.itemName}" from the purchasing checklist.`
  };
}
