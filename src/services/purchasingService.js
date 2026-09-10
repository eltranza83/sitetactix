/**
 * SiteTactix Structured Purchasing Engine (Firestore-First Architecture)
 * 
 * Provides decoupled, domain-driven purchasing operations for project lots:
 * - Single source of truth in structured storage (Firestore / LocalStorage)
 * - Decoupled Storage Adapter Layer
 * - Clean status lifecycle ('needed' | 'purchased')
 * - Complete project/lot isolation
 * - On-demand one-way Google Doc / PDF markdown export
 */

import { getFirebaseDb } from './firebase.js';
import { collection, doc, getDocs, setDoc, deleteDoc, getDoc } from 'firebase/firestore/lite';

import { TRADE_SECTION_MAP, TRADE_CATEGORIES } from '../config/tradesConfig.js';

export const PURCHASING_STATUSES = {
  NEEDED: 'needed',
  PURCHASED: 'purchased'
};

export { TRADE_SECTION_MAP, TRADE_CATEGORIES };


export const STANDARD_MASTER_ITEMS = [
  // Quartz
  { id: 'quartz_electrical_pass_through', categoryId: 'quartz', itemName: 'Electrical pass-through caps', quantity: 1, status: 'needed' },
  { id: 'quartz_sinks', categoryId: 'quartz', itemName: 'Sinks', quantity: 1, status: 'needed' },
  // Electrical
  { id: 'elec_security_lights', categoryId: 'electrical', itemName: 'Security lights', quantity: 1, status: 'needed' },
  { id: 'elec_doorbell_chime_kit', categoryId: 'electrical', itemName: 'Contractor doorbell chime kit', quantity: 1, status: 'needed' },
  { id: 'elec_smart_doorbell', categoryId: 'electrical', itemName: 'Smart doorbell', quantity: 1, status: 'needed' },
  { id: 'elec_front_porch_hanging_light', categoryId: 'electrical', itemName: 'Front porch hanging light', quantity: 1, status: 'needed' },
  { id: 'elec_exterior_column_lights', categoryId: 'electrical', itemName: 'Exterior column lights', quantity: 1, status: 'needed' },
  { id: 'elec_garage_ceiling_lights', categoryId: 'electrical', itemName: 'Garage ceiling lights with the cap to install it', quantity: 1, status: 'needed' },
  { id: 'elec_vanity_lights', categoryId: 'electrical', itemName: 'Vanity lights', quantity: 1, status: 'needed' },
  { id: 'elec_smart_switches', categoryId: 'electrical', itemName: 'Smart switches', quantity: 1, status: 'needed' },
  { id: 'elec_extension_rods', categoryId: 'electrical', itemName: 'Extension rods', quantity: 1, status: 'needed' },
  { id: 'elec_ceiling_fans', categoryId: 'electrical', itemName: 'Ceiling fans', quantity: 1, status: 'needed' },
  // Plumbing
  { id: 'plumb_soap_dispenser', categoryId: 'plumbing', itemName: 'Soap dispenser', quantity: 1, status: 'needed' },
  { id: 'plumb_disposal_power_button', categoryId: 'plumbing', itemName: 'Garbage disposal power button', quantity: 1, status: 'needed' },
  { id: 'plumb_garbage_disposal', categoryId: 'plumbing', itemName: 'Garbage disposal', quantity: 1, status: 'needed' },
  { id: 'plumb_water_heater', categoryId: 'plumbing', itemName: 'Water heater with the water heater stand and tray', quantity: 1, status: 'needed' },
  { id: 'plumb_shower_kits', categoryId: 'plumbing', itemName: 'Shower kits', quantity: 1, status: 'needed' },
  { id: 'plumb_toilets', categoryId: 'plumbing', itemName: 'Toilets', quantity: 1, status: 'needed' },
  { id: 'plumb_rough_in_valves', categoryId: 'plumbing', itemName: 'Rough-in shower valves', quantity: 1, status: 'needed' },
  { id: 'plumb_faucets', categoryId: 'plumbing', itemName: 'Faucets', quantity: 1, status: 'needed' }
];

export function generateItemId(rawName = '', categoryId = null, existingItem = null) {
  if (existingItem && existingItem.id) {
    return existingItem.id;
  }
  const clean = String(rawName || '')
    .toLowerCase()
    .trim()
    .replace(/<!--.*?-->/g, '')
    .replace(/[-—–:]\s*(?:qty|quantity|count):.*$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (categoryId) {
    const cleanCat = String(categoryId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return clean ? `item_${cleanCat}_${clean}` : `item_${cleanCat}_${Date.now()}`;
  }
  return clean ? `item_${clean}` : `item_${Date.now()}`;
}

export function classifyTradeCategory(itemText = '', explicitOverride = null) {
  if (explicitOverride) {
    const cleanOverride = String(explicitOverride).trim().toLowerCase();
    for (const [key, section] of Object.entries(TRADE_SECTION_MAP)) {
      if (
        key === cleanOverride ||
        cleanOverride.includes(key) ||
        section.title.toLowerCase() === cleanOverride ||
        cleanOverride.includes(section.title.toLowerCase()) ||
        section.aliases.some(a => cleanOverride === a.toLowerCase() || cleanOverride.includes(a.toLowerCase()))
      ) {
        return section;
      }
    }
  }

  const cleanText = String(itemText || '').toLowerCase().trim();
  if (!cleanText) return TRADE_SECTION_MAP.general;

  for (const [key, section] of Object.entries(TRADE_SECTION_MAP)) {
    if (key === 'general') continue;
    for (const alias of section.aliases) {
      if (cleanText === alias || cleanText.includes(alias)) {
        return section;
      }
    }
    for (const keyword of section.keywords) {
      if (cleanText === keyword || cleanText.includes(keyword)) {
        return section;
      }
    }
  }

  return TRADE_SECTION_MAP.general;
}

export function parseQuantity(rawText = '') {
  if (typeof rawText === 'object' && rawText !== null) {
    return {
      itemId: rawText.id || rawText.itemId || generateItemId(rawText.itemName || rawText.name),
      itemName: String(rawText.itemName || rawText.name || '').trim(),
      quantity: Number(rawText.quantity) || 1,
      hasExplicitQuantity: rawText.quantity !== undefined,
      status: rawText.status || PURCHASING_STATUSES.NEEDED,
      notes: rawText.notes || ''
    };
  }
  let text = String(rawText || '').trim();
  
  let embeddedId = null;
  const idMatch = text.match(/<!--\s*id:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  if (idMatch) {
    embeddedId = idMatch[1];
    text = text.replace(idMatch[0], '').trim();
  }

  let status = PURCHASING_STATUSES.NEEDED;
  const statusMatch = text.match(/<!--\s*status:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  if (statusMatch) {
    status = statusMatch[1].toLowerCase();
    text = text.replace(statusMatch[0], '').trim();
  }

  const wordNumbers = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'dozen': 12, 'twenty': 20
  };

  const qtySuffixMatch = text.match(/^(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?(.+?)(?:\s*[-—–:]\s*(?:Qty|Quantity|Count):\s*(\d+))(.*)$/i);
  if (qtySuffixMatch) {
    const rawItem = qtySuffixMatch[1].trim();
    const additionalNotes = qtySuffixMatch[3] ? qtySuffixMatch[3].trim() : '';
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: parseInt(qtySuffixMatch[2], 10) || 1,
      hasExplicitQuantity: true,
      status,
      notes: additionalNotes
    };
  }

  const isExplicitIncrement = /\b(more|additional|another)\b/i.test(text);

  const wordPrefixMatch = text.match(/^(?:add\s+|i need\s+|buy\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s+(?:more\s+)?(.+)$/i);
  if (wordPrefixMatch && !text.toLowerCase().includes('inch') && !text.toLowerCase().includes('gallon')) {
    const qty = wordNumbers[wordPrefixMatch[1].toLowerCase()] || 1;
    const rawItem = wordPrefixMatch[2].replace(/\b(more|additional)\b/gi, '').trim();
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: qty,
      hasExplicitQuantity: true,
      isExplicitIncrement,
      status,
      notes: ''
    };
  }

  const digitPrefixMatch = text.match(/^(?:add\s+|i need\s+|buy\s+)?(\d+)\s+(?:more\s+|x\s+)?(.+)$/i);
  if (digitPrefixMatch && !text.toLowerCase().includes('inch') && !text.toLowerCase().includes('gallon')) {
    const qty = parseInt(digitPrefixMatch[1], 10) || 1;
    const rawItem = digitPrefixMatch[2].replace(/\b(more|additional)\b/gi, '').trim();
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: qty,
      hasExplicitQuantity: true,
      isExplicitIncrement,
      status,
      notes: ''
    };
  }

  const cleaned = text.replace(/^(?:add\s+|i need\s+|buy\s+)/i, '').replace(/\b(another|more|additional)\b/gi, '').trim();
  return {
    itemId: embeddedId || generateItemId(cleaned),
    itemName: cleaned,
    quantity: 1,
    hasExplicitQuantity: false,
    isExplicitIncrement,
    status,
    notes: ''
  };
}

/**
 * In-Memory / LocalStorage Adapter for Offline Execution & Unit Tests
 */
export class LocalStoragePurchasingAdapter {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.memoryStore = new Map();
  }

  _getKey(projectId) {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `sitetactix_purchasing_items_${cleanId}`;
  }

  async getItems(projectId) {
    const key = this._getKey(projectId);
    const storageObj = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storageObj?.getItem) {
      const raw = storageObj.getItem(key);
      if (raw) {
        try {
          return JSON.parse(raw) || [];
        } catch {}
      }
      return [];
    }
    return this.memoryStore.get(key) || [];
  }

  async saveItems(projectId, items = []) {
    const key = this._getKey(projectId);
    const serialized = JSON.stringify(items);
    const storageObj = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storageObj?.setItem) {
      storageObj.setItem(key, serialized);
    }
    this.memoryStore.set(key, items);
    return items;
  }

  async deleteItem(projectId, itemId) {
    if (!itemId) return;
    const existing = await this.getItems(projectId);
    const filtered = existing.filter(it => it.id !== itemId);
    await this.saveItems(projectId, filtered);
  }

  async getMetadata(projectId) {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const key = `sitetactix_purchasing_meta_${cleanId}`;
    const storageObj = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storageObj?.getItem) {
      const raw = storageObj.getItem(key);
      if (raw) {
        try {
          return JSON.parse(raw) || null;
        } catch {}
      }
    }
    return this.memoryStore.get(key) || null;
  }

  async saveMetadata(projectId, meta = {}) {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const key = `sitetactix_purchasing_meta_${cleanId}`;
    const payload = { ...meta, updatedAt: new Date().toISOString() };
    const serialized = JSON.stringify(payload);
    const storageObj = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storageObj?.setItem) {
      storageObj.setItem(key, serialized);
    }
    this.memoryStore.set(key, payload);
    return payload;
  }
}

/**
 * Production Cloud Firestore Storage Adapter with Offline Fallback
 */
export class FirestorePurchasingAdapter {
  constructor(db = null) {
    this.db = db;
    this.fallback = new LocalStoragePurchasingAdapter();
  }

  _getDb() {
    if (this.db) return this.db;
    if (typeof window !== 'undefined') {
      try {
        return getFirebaseDb();
      } catch (err) {
        console.warn('[FirestorePurchasingAdapter] Failed to get Firebase DB:', err);
      }
    }
    return null;
  }

  async getItems(projectId) {
    const database = this._getDb();
    if (!database) {
      return await this.fallback.getItems(projectId);
    }
    try {
      const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const itemsCol = collection(database, 'projects', cleanId, 'purchasing_items');
      const snap = await getDocs(itemsCol);
      const items = [];
      snap.forEach(docSnap => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      if (items.length > 0) {
        await this.fallback.saveItems(projectId, items);
        return items;
      }
      
      // If Firestore is empty (0 docs in purchasing_items):
      // Check if local cache has items that were saved offline or during transition
      const fallbackItems = await this.fallback.getItems(projectId);
      if (fallbackItems && fallbackItems.length > 0) {
        for (const item of fallbackItems) {
          if (!item.id) continue;
          const itemRef = doc(database, 'projects', cleanId, 'purchasing_items', item.id);
          await setDoc(itemRef, item, { merge: true });
        }
        return fallbackItems;
      }
      return [];
    } catch (err) {
      console.warn('[FirestorePurchasingAdapter] Falling back to local cache:', err);
      return await this.fallback.getItems(projectId);
    }
  }

  async saveItems(projectId, items = []) {
    await this.fallback.saveItems(projectId, items);
    const database = this._getDb();
    if (!database) return items;

    try {
      const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      for (const item of items) {
        if (!item.id) continue;
        const itemRef = doc(database, 'projects', cleanId, 'purchasing_items', item.id);
        await setDoc(itemRef, item, { merge: true });
      }
    } catch (err) {
      console.warn('[FirestorePurchasingAdapter] Error writing to Firestore:', err);
    }
    return items;
  }

  async deleteItem(projectId, itemId) {
    if (!itemId) return;
    if (this.fallback?.deleteItem) {
      await this.fallback.deleteItem(projectId, itemId);
    }
    const database = this._getDb();
    if (!database) return;
    try {
      const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const itemRef = doc(database, 'projects', cleanId, 'purchasing_items', itemId);
      await deleteDoc(itemRef);
    } catch (err) {
      console.warn('[FirestorePurchasingAdapter] Error deleting item from Firestore:', err);
    }
  }

  async getMetadata(projectId) {
    const database = this._getDb();
    if (!database) {
      return await this.fallback.getMetadata(projectId);
    }
    try {
      const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const metaRef = doc(database, 'projects', cleanId, 'purchasing_meta', 'status');
      const snap = await getDoc(metaRef);
      if (snap.exists()) {
        const data = snap.data();
        await this.fallback.saveMetadata(projectId, data);
        return data;
      }
      return await this.fallback.getMetadata(projectId);
    } catch {
      return await this.fallback.getMetadata(projectId);
    }
  }

  async saveMetadata(projectId, meta = {}) {
    await this.fallback.saveMetadata(projectId, meta);
    const database = this._getDb();
    if (!database) return meta;

    try {
      const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const metaRef = doc(database, 'projects', cleanId, 'purchasing_meta', 'status');
      await setDoc(metaRef, { ...meta, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.warn('[FirestorePurchasingAdapter] Error writing metadata to Firestore:', err);
    }
    return meta;
  }
}

/**
 * Core Purchasing Service Domain Engine
 */
export class PurchasingService {
  constructor(storageAdapter = new LocalStoragePurchasingAdapter()) {
    this.storage = storageAdapter;
  }

  setStorageAdapter(adapter) {
    this.storage = adapter;
  }

  _normalizeQuery(str = '') {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  _stemWord(str = '') {
    const s = this._normalizeQuery(str);
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('es') && s.length > 4) return s.slice(0, -2);
    if (s.endsWith('s') && s.length > 3) return s.slice(0, -1);
    return s;
  }

  async getItems(projectId, filter = {}) {
    const allItems = await this.storage.getItems(projectId);
    const { category, categoryId, trade, status, unpurchasedOnly, item, keyword } = filter;

    const targetCategory = categoryId || category || trade || null;
    const cleanCat = targetCategory ? classifyTradeCategory('', targetCategory).id : null;
    const searchNormalized = this._normalizeQuery(item || keyword || '');
    const searchStem = this._stemWord(item || keyword || '');

    return allItems.filter(it => {
      if (cleanCat && it.categoryId !== cleanCat && cleanCat !== 'general') {
        return false;
      }
      if (unpurchasedOnly || status === PURCHASING_STATUSES.NEEDED) {
        if (it.status !== PURCHASING_STATUSES.NEEDED) return false;
      } else if (status === PURCHASING_STATUSES.PURCHASED) {
        if (it.status !== PURCHASING_STATUSES.PURCHASED) return false;
      }
      if (searchNormalized) {
        const itNorm = it.normalizedName || this._normalizeQuery(it.itemName);
        const itStem = this._stemWord(it.itemName);
        const matchesExact = itNorm.includes(searchNormalized) || searchNormalized.includes(itNorm);
        const matchesStem = itStem.includes(searchStem) || searchStem.includes(itStem);
        if (!matchesExact && !matchesStem) return false;
      }
      return true;
    });
  }

  async getItemById(projectId, itemId) {
    const items = await this.storage.getItems(projectId);
    return items.find(it => it.id === itemId) || null;
  }

  async findItemByName(projectId, itemName) {
    const searchNorm = this._normalizeQuery(itemName);
    const searchStem = this._stemWord(itemName);
    const items = await this.storage.getItems(projectId);

    return items.find(it => {
      const itNorm = it.normalizedName || this._normalizeQuery(it.itemName);
      const itStem = this._stemWord(it.itemName);
      return itNorm === searchNorm || itNorm.includes(searchNorm) || searchNorm.includes(itNorm) || itStem === searchStem;
    }) || null;
  }

  async addItem(projectId, itemInput, quantityOrCategory = 1, explicitCategory = null) {
    let quantity = 1;
    let categoryOverride = null;

    if (typeof quantityOrCategory === 'number') {
      quantity = quantityOrCategory;
      categoryOverride = explicitCategory;
    } else if (typeof quantityOrCategory === 'string') {
      categoryOverride = quantityOrCategory;
    }

    const parsed = parseQuantity(itemInput);
    const effectiveQty = Math.max(quantity || 1, parsed.quantity || 1);
    const category = classifyTradeCategory(parsed.itemName, categoryOverride);
    const normalizedName = this._normalizeQuery(parsed.itemName);
    const now = new Date().toISOString();

    if (projectId === 'purchasing_master') {
      const currentMaster = await this.storage.getItems('purchasing_master');
      if (currentMaster.length === 0) {
        let masterDocText = null;
        if (typeof localStorage !== 'undefined') {
          masterDocText = localStorage.getItem('sitetactix_purchasing_doc_purchasing_master') || localStorage.getItem('sitetactix_master_purchasing_checklist');
        }
        if (masterDocText && (masterDocText.includes('- [ ]') || masterDocText.includes('- [x]') || masterDocText.includes('## '))) {
          await this.migrateFromGoogleDocContent('purchasing_master', masterDocText);
        } else {
          await this.initializeProjectFromMaster('purchasing_master', STANDARD_MASTER_ITEMS);
        }
      }
    }

    const existingItems = await this.storage.getItems(projectId);
    const match = this.findMatchingItems(existingItems, parsed.itemName);
    let existingIndex = -1;
    if (match && (match.type === 'EXACT' || match.type === 'SINGLE_MATCH')) {
      existingIndex = existingItems.findIndex(it => it.id === match.item.id);
    }

    if (existingIndex >= 0) {
      const existing = existingItems[existingIndex];

      // If user explicitly requested an increment (e.g. "Add 2 more pool heaters", "Add another pool heater")
      if (parsed.isExplicitIncrement) {
        const updatedQty = (existing.quantity || 1) + effectiveQty;
        const updatedItem = {
          ...existing,
          quantity: updatedQty,
          status: PURCHASING_STATUSES.NEEDED, // Re-activate if needed
          updatedAt: now
        };
        existingItems[existingIndex] = updatedItem;
        await this.storage.saveItems(projectId, existingItems);
        return {
          success: true,
          action: 'UPDATE_QUANTITY',
          isDuplicate: true,
          item: updatedItem,
          message: `Updated ${updatedItem.itemName} quantity to ${updatedQty} under ${category.title}.`
        };
      }

      // Idempotent duplicate: User simply repeated "Add a pool heater" when it already exists
      return {
        success: true,
        action: 'ALREADY_EXISTS',
        isDuplicate: true,
        item: existing,
        message: `"${existing.itemName}" is already on the ${projectId} purchasing checklist (Qty: ${existing.quantity || 1}, ${existing.status === PURCHASING_STATUSES.PURCHASED ? 'Purchased' : 'Needed'}).`
      };
    }

    const newItem = {
      id: parsed.itemId || generateItemId(parsed.itemName),
      projectId,
      categoryId: category.id,
      categoryTitle: category.title,
      itemName: parsed.itemName,
      normalizedName,
      quantity: effectiveQty,
      status: PURCHASING_STATUSES.NEEDED,
      notes: parsed.notes || '',
      source: 'user_added',
      createdAt: now,
      updatedAt: now
    };

    existingItems.push(newItem);
    await this.storage.saveItems(projectId, existingItems);

    return {
      success: true,
      action: 'INSERT_ITEM',
      isDuplicate: false,
      item: newItem,
      message: `Added "${newItem.itemName}" (Qty: ${effectiveQty}) to ${category.title}.`
    };
  }

  /**
   * 3-Way Purchasing Item Match Resolver
   * Single authoritative matching engine for status queries and mutations.
   * Returns:
   *  - { type: 'EXACT', matches: [item], item: item } (1 exact match by ID or exact normalized name)
   *  - { type: 'SINGLE_MATCH', matches: [item], item: item } (1 unambiguous fuzzy match)
   *  - { type: 'AMBIGUOUS', matches: [item1, item2, ...] } (>1 candidate matches, strictly zero mutations allowed)
   *  - { type: 'NONE', matches: [] } (0 matches)
   */
  findMatchingItems(existingItems = [], itemNameOrQuery = '') {
    if (!itemNameOrQuery || !Array.isArray(existingItems) || existingItems.length === 0) {
      return { type: 'NONE', matches: [], item: null };
    }

    const rawQuery = String(itemNameOrQuery).trim();
    const searchNorm = this._normalizeQuery(rawQuery);

    const stopwords = new Set(['did', 'we', 'already', 'buy', 'bought', 'purchase', 'purchased', 'get', 'got', 'is', 'was', 'are', 'mark', 'as', 'needed', 'the', 'a', 'an', 'those', 'these', 'that', 'this', 'for', 'lot', 'check', 'please', 'with', 'and', 'from', 'all', 'any', 'have', 'yet', 'now', 'recently', 'so', 'far', 'tray', 'stand', 'cap', 'kit']);

    // 1. Exact ID match (absolute highest priority)
    const exactIdMatch = existingItems.find(it => it.id === rawQuery || it.id === searchNorm);
    if (exactIdMatch) {
      return { type: 'EXACT', matches: [exactIdMatch], item: exactIdMatch };
    }

    // 2. Exact Normalized Name match
    const exactNameMatches = existingItems.filter(it => {
      const itNorm = it.normalizedName || this._normalizeQuery(it.itemName);
      return itNorm === searchNorm;
    });
    if (exactNameMatches.length === 1) {
      return { type: 'EXACT', matches: exactNameMatches, item: exactNameMatches[0] };
    } else if (exactNameMatches.length > 1) {
      return { type: 'AMBIGUOUS', matches: exactNameMatches, item: null };
    }

    // 3. Multi-word Exact Substring Match if query has multiple meaningful words (e.g. "security lights")
    if (rawQuery.includes(' ') && searchNorm.length > 5) {
      const fullSubstringMatches = existingItems.filter(it => {
        const itNorm = it.normalizedName || this._normalizeQuery(it.itemName);
        return itNorm === searchNorm || itNorm.includes(searchNorm) || searchNorm.includes(itNorm);
      });
      if (fullSubstringMatches.length === 1) {
        return { type: 'SINGLE_MATCH', matches: fullSubstringMatches, item: fullSubstringMatches[0] };
      } else if (fullSubstringMatches.length > 1) {
        return { type: 'AMBIGUOUS', matches: fullSubstringMatches, item: null };
      }
    }

    // 4. Stemmed Token Matching (e.g. "lights" -> matches "light", "security", "doorbell", etc.)
    const cleanTokens = rawQuery
      .toLowerCase()
      .split(/[^a-zA-Z0-9]+/)
      .filter(w => w.length > 2 && !stopwords.has(w));

    if (cleanTokens.length > 0) {
      const tokenStems = cleanTokens.map(ct => this._stemWord(ct));

      const matchingCandidates = existingItems.filter(it => {
        const itWords = (it.itemName || '').toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !stopwords.has(w));
        const itStems = itWords.map(w => this._stemWord(w));

        // For a multi-word search query (e.g. "security lights"), check if ALL query stems match item stems
        if (tokenStems.length > 1) {
          const allMatch = tokenStems.every(ts => itStems.includes(ts));
          if (allMatch) return true;
          return false;
        }

        // For a single-word generic query (e.g. "lights", "doorbell", "fans"), check if any item word stem equals the query stem
        return tokenStems.some(ts => itStems.includes(ts));
      });

      if (matchingCandidates.length === 1) {
        return { type: 'SINGLE_MATCH', matches: matchingCandidates, item: matchingCandidates[0] };
      } else if (matchingCandidates.length > 1) {
        return { type: 'AMBIGUOUS', matches: matchingCandidates, item: null };
      }
    }

    return { type: 'NONE', matches: [], item: null };
  }

  async updateItemStatus(projectId, itemNameOrId, newStatus = PURCHASING_STATUSES.PURCHASED) {
    const existingItems = await this.storage.getItems(projectId);
    const matchResult = this.findMatchingItems(existingItems, itemNameOrId);

    if (matchResult.type === 'AMBIGUOUS') {
      const candidateList = matchResult.matches.map(m => `• ${m.itemName} (${m.status === PURCHASING_STATUSES.PURCHASED ? 'Purchased' : 'Needed'})`).join('\n');
      return {
        success: false,
        isAmbiguous: true,
        matches: matchResult.matches,
        message: `Multiple items match "${itemNameOrId}":\n${candidateList}\nPlease specify which item you would like to mark.`
      };
    }

    if (matchResult.type === 'NONE') {
      return {
        success: false,
        isNotFound: true,
        message: `"${itemNameOrId}" is not currently listed on the ${projectId} purchasing checklist, so no changes were made.`
      };
    }

    const item = matchResult.item;
    const index = existingItems.findIndex(it => it.id === item.id);
    if (index === -1) {
      return {
        success: false,
        isNotFound: true,
        message: `Item "${itemNameOrId}" was not found in the purchasing list for ${projectId}.`
      };
    }

    const statusLabel = newStatus === PURCHASING_STATUSES.PURCHASED ? 'purchased' : 'needed';

    // Idempotency check: If item already has the requested status, perform 0 writes
    if (item.status === newStatus) {
      return {
        success: true,
        action: 'NO_OP',
        status: newStatus === PURCHASING_STATUSES.PURCHASED ? 'ALREADY_PURCHASED' : 'ALREADY_NEEDED',
        isAlreadyInState: true,
        writesPerformed: 0,
        item,
        message: `The ${item.itemName} is already marked as ${statusLabel}.`
      };
    }

    const now = new Date().toISOString();
    const updated = {
      ...item,
      status: newStatus,
      updatedAt: now
    };

    existingItems[index] = updated;
    await this.storage.saveItems(projectId, existingItems);

    return {
      success: true,
      action: 'UPDATE_STATUS',
      writesPerformed: 1,
      item: updated,
      message: `Marked ${updated.itemName} as ${statusLabel}.`
    };
  }

  async updateItemQuantity(projectId, itemNameOrId, newQuantity = 1) {
    const existingItems = await this.storage.getItems(projectId);
    const matchResult = this.findMatchingItems(existingItems, itemNameOrId);

    if (matchResult.type === 'AMBIGUOUS') {
      return {
        success: false,
        isAmbiguous: true,
        matches: matchResult.matches,
        message: `Multiple items match "${itemNameOrId}". Please specify which item quantity to update.`
      };
    }

    if (matchResult.type === 'NONE') {
      return { success: false, isNotFound: true, message: `Item "${itemNameOrId}" not found.` };
    }

    const item = matchResult.item;
    const index = existingItems.findIndex(it => it.id === item.id);
    const qty = Math.max(1, parseInt(newQuantity, 10) || 1);
    const updated = { ...item, quantity: qty, updatedAt: new Date().toISOString() };
    existingItems[index] = updated;
    await this.storage.saveItems(projectId, existingItems);

    return {
      success: true,
      item: updated,
      message: `Updated ${updated.itemName} quantity to ${qty}.`
    };
  }

  async removeItem(projectId, itemNameOrId) {
    const existingItems = await this.storage.getItems(projectId);
    const matchResult = this.findMatchingItems(existingItems, itemNameOrId);

    if (matchResult.type === 'AMBIGUOUS') {
      const candidateList = matchResult.matches.map(m => `• ${m.itemName}`).join('\n');
      return {
        success: false,
        isAmbiguous: true,
        matches: matchResult.matches,
        message: `Multiple items match "${itemNameOrId}":\n${candidateList}\nPlease specify which item you would like to remove.`
      };
    }

    if (matchResult.type === 'NONE') {
      return {
        success: false,
        isNotFound: true,
        message: `"${itemNameOrId}" is not currently listed on the ${projectId} purchasing checklist.`
      };
    }

    const item = matchResult.item;
    const index = existingItems.findIndex(it => it.id === item.id);
    if (index === -1) {
      return { success: false, message: `Item "${itemNameOrId}" not found in ${projectId}.` };
    }

    const removed = existingItems.splice(index, 1)[0];
    await this.storage.saveItems(projectId, existingItems);
    if (typeof this.storage.deleteItem === 'function' && removed?.id) {
      await this.storage.deleteItem(projectId, removed.id);
    }

    return {
      success: true,
      item: removed,
      message: `Removed "${removed.itemName}" from the purchasing checklist.`
    };
  }

  async isProjectInitialized(projectId) {
    if (typeof this.storage.getMetadata === 'function') {
      const meta = await this.storage.getMetadata(projectId);
      if (meta && meta.initialized) return true;
    }
    const items = await this.storage.getItems(projectId);
    return items && items.length > 0;
  }

  async setProjectInitialized(projectId, meta = {}) {
    if (typeof this.storage.saveMetadata === 'function') {
      return await this.storage.saveMetadata(projectId, {
        initialized: true,
        ...meta
      });
    }
    return { initialized: true, ...meta };
  }

  async initializeProjectFromMaster(projectId, defaultItems = STANDARD_MASTER_ITEMS, options = {}) {
    const isInit = await this.isProjectInitialized(projectId);
    const existing = await this.storage.getItems(projectId);
    if (isInit && existing && existing.length > 0) {
      return { success: true, count: existing.length, items: existing, alreadyInitialized: true };
    }

    const now = new Date().toISOString();
    const cloned = defaultItems.map(it => ({
      ...it,
      id: it.id || generateItemId(it.itemName),
      projectId,
      normalizedName: this._normalizeQuery(it.itemName),
      status: it.status || PURCHASING_STATUSES.NEEDED,
      source: 'master_template',
      createdAt: now,
      updatedAt: now
    }));

    await this.storage.saveItems(projectId, cloned);
    await this.setProjectInitialized(projectId, {
      source: 'master_template',
      sourceDocId: options.sourceDocId || null,
      itemCount: cloned.length
    });

    return { success: true, count: cloned.length, items: cloned, alreadyInitialized: false };
  }

  async exportToGoogleDocMarkdown(projectId, options = {}) {
    const cleanProjName = String(projectId || 'Project').replace(/^lot_?(\d+)$/i, (_, n) => `Lot ${n}`);
    const { title = `Master Fixtures & Hardware Purchasing Checklist - ${cleanProjName}` } = options;
    const items = await this.storage.getItems(projectId);

    const categoryOrder = ['quartz', 'electrical', 'plumbing', 'hvac', 'paint_drywall', 'general'];
    const grouped = {};

    for (const catKey of categoryOrder) {
      grouped[catKey] = {
        title: TRADE_SECTION_MAP[catKey]?.title || catKey,
        items: []
      };
    }

    for (const it of items) {
      const cat = it.categoryId || 'general';
      if (!grouped[cat]) {
        grouped[cat] = {
          title: TRADE_SECTION_MAP[cat]?.title || it.categoryTitle || cat,
          items: []
        };
      }
      grouped[cat].items.push(it);
    }

    const lines = [`# ${title}`, 'Applicable to all lots and standard builds.', ''];

    let sectionNum = 1;
    for (const catKey of categoryOrder) {
      const sec = grouped[catKey];
      if (!sec || sec.items.length === 0) continue;

      lines.push(`## ${sectionNum}. ${sec.title}`);
      for (const it of sec.items) {
        const check = it.status === PURCHASING_STATUSES.PURCHASED ? 'x' : ' ';
        const qtyStr = it.quantity > 1 ? ` — Qty: ${it.quantity}` : '';
        const notesStr = it.notes ? ` (${it.notes})` : '';
        lines.push(`- [${check}] ${it.itemName}${qtyStr}${notesStr}`);
      }
      lines.push('');
      sectionNum++;
    }

    return lines.join('\n').trim() + '\n';
  }

  async syncMasterToProjects(targetProjectIds = []) {
    const masterItems = await this.storage.getItems('purchasing_master');
    const results = [];

    for (const projectId of targetProjectIds) {
      const projectItems = await this.storage.getItems(projectId);
      let itemsAdded = 0;

      for (const masterItem of masterItems) {
        const mNorm = masterItem.normalizedName || this._normalizeQuery(masterItem.itemName);
        const alreadyExists = projectItems.some(it => {
          const itNorm = it.normalizedName || this._normalizeQuery(it.itemName);
          return itNorm === mNorm;
        });

        if (!alreadyExists) {
          projectItems.push({
            ...masterItem,
            id: generateItemId(masterItem.itemName),
            projectId,
            status: PURCHASING_STATUSES.NEEDED,
            source: 'master_template',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          itemsAdded++;
        }
      }

      if (itemsAdded > 0) {
        await this.storage.saveItems(projectId, projectItems);
      }
      results.push({ projectId, itemsAdded });
    }

    return { success: true, projectsSynced: targetProjectIds, details: results };
  }

  async migrateFromGoogleDocContent(projectId, docText = '', options = {}) {
    if (!docText || typeof docText !== 'string') {
      return { success: false, count: 0, items: [] };
    }

    const rawLines = docText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const migrated = [];
    let currentCategory = TRADE_SECTION_MAP.general;

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('# ') || trimmed.toLowerCase().startsWith('applicable to')) continue;

      const sectionMatch = trimmed.match(/<!--\s*section:\s*([a-zA-Z0-9_-]+)\s*-->/i);
      if (sectionMatch) {
        currentCategory = classifyTradeCategory('', sectionMatch[1]);
        continue;
      }

      if (trimmed.startsWith('## ') || /^\d+[.)]\s+[A-Za-z]/.test(trimmed)) {
        const headerTitle = trimmed.replace(/^[#\d.)\s]+/, '').trim();
        currentCategory = classifyTradeCategory('', headerTitle);
        continue;
      }

      const isItem = /^[-*•+o☐☑☒☐☑☒]/.test(trimmed) || /^\[[ xX]?\]/.test(trimmed);
      if (isItem) {
        const isPurchased = /[☑☒☑☒]/.test(trimmed) || /\[[xX]\]/.test(trimmed);
        const cleanedText = trimmed
          .replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒\-*•+o\s]+/, '')
          .replace(/^\[[ xX]?\]\s*/, '')
          .trim();
        if (cleanedText) {
          const parsed = parseQuantity(cleanedText);
          const itemCategory = classifyTradeCategory(parsed.itemName, currentCategory.id);
          const now = new Date().toISOString();

          const existingItems = await this.storage.getItems(projectId);
          const existingMatch = existingItems.find(it => {
            const sameCategory = !it.categoryId || it.categoryId === itemCategory.id;
            const sameName = (it.normalizedName && it.normalizedName === this._normalizeQuery(parsed.itemName)) ||
                             (it.itemName && it.itemName.toLowerCase() === parsed.itemName.toLowerCase());
            return sameCategory && sameName;
          });

          migrated.push({
            id: parsed.itemId || generateItemId(parsed.itemName, itemCategory.id, existingMatch),
            projectId,
            categoryId: itemCategory.id,
            categoryTitle: itemCategory.title,
            itemName: parsed.itemName,
            normalizedName: this._normalizeQuery(parsed.itemName),
            quantity: parsed.quantity || 1,
            status: isPurchased ? PURCHASING_STATUSES.PURCHASED : PURCHASING_STATUSES.NEEDED,
            notes: parsed.notes || '',
            source: options.source || 'google_doc_migration',
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }

    if (migrated.length > 0) {
      // Idempotent merge with existing items
      const existing = await this.storage.getItems(projectId);
      const existingMap = new Map(existing.map(it => [it.id, it]));
      for (const item of migrated) {
        if (!existingMap.has(item.id)) {
          existingMap.set(item.id, item);
        }
      }
      const combined = Array.from(existingMap.values());
      await this.storage.saveItems(projectId, combined);
      await this.setProjectInitialized(projectId, {
        source: options.source || 'google_doc_migration',
        sourceDocId: options.sourceDocId || null,
        sourceDocName: options.sourceDocName || null,
        itemCount: combined.length
      });
      return { success: true, count: combined.length, items: combined };
    }

    return { success: true, count: 0, items: [] };
  }
}

export function createDefaultPurchasingStorageAdapter() {
  if (typeof window !== 'undefined') {
    return new FirestorePurchasingAdapter();
  }
  return new LocalStoragePurchasingAdapter();
}

export const purchasingService = new PurchasingService(createDefaultPurchasingStorageAdapter());
