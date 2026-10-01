import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PurchasingService,
  FirestorePurchasingAdapter,
  LocalStoragePurchasingAdapter,
  PURCHASING_STATUSES,
  STANDARD_MASTER_ITEMS,
  TRADE_SECTION_MAP
} from '../src/services/purchasingService.js';

import { executeClientToolCall, clearIdempotencyCache } from '../src/services/aiTools.js';
import { formatToolResultsHumanReadable } from '../src/services/builderBrainService.js';

/**
 * In-memory Mock Firestore Database replicating Firebase Firestore Lite SDK behavior:
 * - doc(db, 'projects', cleanId, 'purchasing_items', itemId)
 * - collection(db, 'projects', cleanId, 'purchasing_items')
 * - setDoc, getDoc, getDocs, deleteDoc
 */
class MockFirestoreDatabase {
  constructor() {
    this.collections = new Map();
  }

  _getCollectionMap(colPath) {
    if (!this.collections.has(colPath)) {
      this.collections.set(colPath, new Map());
    }
    return this.collections.get(colPath);
  }

  setDoc(colPath, docId, data) {
    const col = this._getCollectionMap(colPath);
    const existing = col.get(docId) || {};
    col.set(docId, { ...existing, ...data });
  }

  getDoc(colPath, docId) {
    const col = this._getCollectionMap(colPath);
    if (!col.has(docId)) {
      return { exists: () => false, data: () => null };
    }
    return { exists: () => true, data: () => col.get(docId) };
  }

  getDocs(colPath) {
    const col = this._getCollectionMap(colPath);
    const docs = [];
    col.forEach((data, id) => {
      docs.push({ id, data: () => data });
    });
    return docs;
  }

  deleteDoc(colPath, docId) {
    const col = this._getCollectionMap(colPath);
    col.delete(docId);
  }

  clear() {
    this.collections.clear();
  }
}

/**
 * Mock Firestore Purchasing Adapter wiring directly into MockFirestoreDatabase
 */
class TestableFirestoreAdapter {
  constructor(mockDb, localStorageInstance) {
    this.db = mockDb;
    this.fallback = new LocalStoragePurchasingAdapter(localStorageInstance);
  }

  async getItems(projectId) {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const colPath = `projects/${cleanId}/purchasing_items`;
    const docSnaps = this.db.getDocs(colPath);
    const items = docSnaps.map(d => ({ id: d.id, ...d.data() }));

    if (items.length > 0) {
      await this.fallback.saveItems(projectId, items);
      return items;
    }

    // Check fallback for transition migration
    const fallbackItems = await this.fallback.getItems(projectId);
    if (fallbackItems && fallbackItems.length > 0) {
      for (const it of fallbackItems) {
        if (!it.id) continue;
        this.db.setDoc(colPath, it.id, it);
      }
      return fallbackItems;
    }

    return [];
  }

  async saveItems(projectId, items = []) {
    await this.fallback.saveItems(projectId, items);
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const colPath = `projects/${cleanId}/purchasing_items`;
    for (const it of items) {
      if (!it.id) continue;
      this.db.setDoc(colPath, it.id, it);
    }
    return items;
  }

  async deleteItem(projectId, itemId) {
    if (!itemId) return;
    await this.fallback.deleteItem(projectId, itemId);
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const colPath = `projects/${cleanId}/purchasing_items`;
    this.db.deleteDoc(colPath, itemId);
  }

  async getMetadata(projectId) {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const colPath = `projects/${cleanId}/purchasing_meta`;
    const snap = this.db.getDoc(colPath, 'status');
    if (snap.exists()) {
      const data = snap.data();
      await this.fallback.saveMetadata(projectId, data);
      return data;
    }
    return await this.fallback.getMetadata(projectId);
  }

  async saveMetadata(projectId, meta = {}) {
    await this.fallback.saveMetadata(projectId, meta);
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const colPath = `projects/${cleanId}/purchasing_meta`;
    const payload = { ...meta, updatedAt: new Date().toISOString() };
    this.db.setDoc(colPath, 'status', payload);
    return payload;
  }
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

describe('Firestore Authoritative Purchasing Persistence Suite', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = new MockFirestoreDatabase();
    clearIdempotencyCache();
  });

  test('1. Status Change persists to Firestore & survives fresh service with empty localStorage', async () => {
    // Device A (Browser Tab 1) has its own localStorage
    const localStoreA = createMockLocalStorage();
    const adapterA = new TestableFirestoreAdapter(mockDb, localStoreA);
    const serviceA = new PurchasingService(adapterA);

    // Initialize Lot 55 from master on Device A
    await serviceA.initializeProjectFromMaster('lot_55');
    const initItems = await serviceA.getItems('lot_55');
    assert.equal(initItems.length, 20);

    // Mark 1 item purchased: Contractor doorbell chime kit
    const markRes = await serviceA.updateItemStatus('lot_55', 'Contractor doorbell chime kit', PURCHASING_STATUSES.PURCHASED);
    assert.equal(markRes.success, true);
    assert.equal(markRes.writesPerformed, 1);

    // Verify Firestore database contains the doc directly
    const firestoreDocs = mockDb.getDocs('projects/lot_55/purchasing_items');
    assert.equal(firestoreDocs.length, 20, 'Firestore collection projects/lot_55/purchasing_items must have 20 docs');
    const chimeDoc = firestoreDocs.find(d => d.id === 'elec_doorbell_chime_kit');
    assert.equal(chimeDoc.data().status, 'purchased');

    // Simulate Device B / Fresh Incognito Tab with completely EMPTY localStorage
    const localStoreB = createMockLocalStorage(); // Empty!
    const adapterB = new TestableFirestoreAdapter(mockDb, localStoreB);
    const serviceB = new PurchasingService(adapterB);

    // Device B reads Lot 55
    const itemsB = await serviceB.getItems('lot_55');
    assert.equal(itemsB.length, 20, 'Device B must receive all 20 items from authoritative Firestore');
    const purchasedB = itemsB.filter(i => i.status === 'purchased');
    assert.equal(purchasedB.length, 1, 'Device B must see 1 purchased item');
    assert.equal(purchasedB[0].itemName, 'Contractor doorbell chime kit');
  });

  test('2. Multi-Device State Sync: Device A adds custom item, Device B reads it without reseeding', async () => {
    const localStoreA = createMockLocalStorage();
    const serviceA = new PurchasingService(new TestableFirestoreAdapter(mockDb, localStoreA));
    await serviceA.initializeProjectFromMaster('lot_55');

    // Device A adds pool heater in Quartz Hardware (making 21 items total)
    const addRes = await serviceA.addItem('lot_55', {
      itemName: 'Pool heater',
      quantity: 2,
      categoryId: 'quartz',
      categoryTitle: 'Quartz Hardware'
    });
    assert.equal(addRes.success, true);

    // Device B (completely empty local storage)
    const localStoreB = createMockLocalStorage();
    const serviceB = new PurchasingService(new TestableFirestoreAdapter(mockDb, localStoreB));

    // Verify isProjectInitialized reports true from Firestore
    const isInit = await serviceB.isProjectInitialized('lot_55');
    assert.equal(isInit, true, 'isProjectInitialized must return true from Firestore metadata/items');

    const itemsB = await serviceB.getItems('lot_55');
    assert.equal(itemsB.length, 21, 'Device B must see all 21 items (including pool heater)');
    const poolHeater = itemsB.find(i => i.itemName.toLowerCase().includes('pool heater'));
    assert.ok(poolHeater, 'Pool heater must exist in Device B view');
    assert.equal(poolHeater.quantity, 2);
    assert.equal(poolHeater.categoryId, 'quartz');
  });

  test('3. Lot 55 Target Intended State: 9 purchased, 12 needed, 21 total across independent instances', async () => {
    // Setup target state on Device A
    const localStoreA = createMockLocalStorage();
    const serviceA = new PurchasingService(new TestableFirestoreAdapter(mockDb, localStoreA));
    await serviceA.initializeProjectFromMaster('lot_55');

    // Add pool heater (item 21, Needed, Quartz Hardware)
    await serviceA.addItem('lot_55', {
      itemName: 'Pool heater',
      quantity: 2,
      categoryId: 'quartz',
      categoryTitle: 'Quartz Hardware'
    });

    // Mark 9 electrical items as purchased
    const allItems = await serviceA.getItems('lot_55');
    const elecItems = allItems.filter(i => i.categoryId === 'electrical');
    assert.equal(elecItems.length, 10);

    for (let i = 0; i < 9; i++) {
      await serviceA.updateItemStatus('lot_55', elecItems[i].itemName, PURCHASING_STATUSES.PURCHASED);
    }

    // Now test a series of 3 fresh instances (Simulating 3 page reloads / devices)
    for (let instanceIdx = 1; instanceIdx <= 3; instanceIdx++) {
      const freshStore = createMockLocalStorage();
      const freshService = new PurchasingService(new TestableFirestoreAdapter(mockDb, freshStore));

      const items = await freshService.getItems('lot_55');
      const purchased = items.filter(i => i.status === PURCHASING_STATUSES.PURCHASED);
      const needed = items.filter(i => i.status === PURCHASING_STATUSES.NEEDED);

      assert.equal(items.length, 21, `Instance ${instanceIdx}: Total must be exactly 21`);
      assert.equal(purchased.length, 9, `Instance ${instanceIdx}: Purchased count must be exactly 9`);
      assert.equal(needed.length, 12, `Instance ${instanceIdx}: Needed count must be exactly 12`);

      // Verify electrical breakdown: 9 purchased, 1 needed
      const elec = items.filter(i => i.categoryId === 'electrical');
      assert.equal(elec.filter(i => i.status === 'purchased').length, 9);
      assert.equal(elec.filter(i => i.status === 'needed').length, 1);

      // Verify Quartz: 3 needed (2 initial + 1 Pool heater)
      const qz = items.filter(i => i.categoryId === 'quartz');
      assert.equal(qz.length, 3);
      const customItem = qz.find(i => i.itemName === 'Pool heater');
      assert.ok(customItem);
      assert.equal(customItem.status, 'needed');
    }
  });

  test('4. Idempotency Invariant in Firestore: Repeated status mutation produces 0 Firestore writes', async () => {
    const localStore = createMockLocalStorage();
    const service = new PurchasingService(new TestableFirestoreAdapter(mockDb, localStore));
    await service.initializeProjectFromMaster('lot_55');

    // 1st Execution: needed -> purchased = 1 write
    const res1 = await service.updateItemStatus('lot_55', 'Contractor doorbell chime kit', PURCHASING_STATUSES.PURCHASED);
    assert.equal(res1.success, true);
    assert.equal(res1.action, 'UPDATE_STATUS');
    assert.equal(res1.writesPerformed, 1);

    // Spy on mockDb.setDoc
    let setDocCalls = 0;
    const originalSetDoc = mockDb.setDoc.bind(mockDb);
    mockDb.setDoc = (...args) => {
      setDocCalls++;
      return originalSetDoc(...args);
    };

    // 2nd Execution: already purchased -> NO_OP = 0 writes
    const res2 = await service.updateItemStatus('lot_55', 'Contractor doorbell chime kit', PURCHASING_STATUSES.PURCHASED);
    assert.equal(res2.success, true);
    assert.equal(res2.action, 'NO_OP');
    assert.equal(res2.status, 'ALREADY_PURCHASED');
    assert.equal(res2.isAlreadyInState, true);
    assert.equal(res2.writesPerformed, 0);
    assert.equal(setDocCalls, 0, 'Firestore setDoc must NOT be called on NO_OP status updates');
  });

  test('5. Safe Uninitialized Project Handling: Querying unknown project does not corrupt other lots', async () => {
    const localStore = createMockLocalStorage();
    const service = new PurchasingService(new TestableFirestoreAdapter(mockDb, localStore));
    await service.initializeProjectFromMaster('lot_55');

    // Query unknown project
    const unknownItems = await service.getItems('lot_999');
    assert.equal(unknownItems.length, 0);

    const isInit = await service.isProjectInitialized('lot_999');
    assert.equal(isInit, false);

    // Lot 55 must remain completely unaffected
    const lot55Items = await service.getItems('lot_55');
    assert.equal(lot55Items.length, 20);
  });
});
