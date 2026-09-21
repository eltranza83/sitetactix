import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

import {
  executeClientToolCall,
  TOOL_REGISTRY
} from '../src/services/aiTools.js';
import {
  parseGoogleDocPurchasingStructure,
  calculateSectionInsertion,
  queryPurchasingList,
  loadProjectPurchasingDoc,
  saveProjectPurchasingDoc,
  getPurchasingDocStorageKey,
  resolveTargetProjectId,
  TRADE_SECTION_MAP
} from '../src/services/googleDocsPurchasingService.js';
import {
  askGeminiBrain,
  resetActiveSessionCognitiveState
} from '../src/services/builderBrainService.js';
import { purchasingService } from '../src/services/purchasingService.js';

const LOT_3_INITIAL_DOC = `# Master Fixtures & Hardware Purchasing Checklist - Lot 3
DocumentId: doc_lot_3_secure_uuid

<!-- section: quartz -->
## 1. Quartz Hardware
- [ ] Electrical pass-through caps

<!-- section: electrical -->
## 2. Electrical Hardware Fixtures
- [ ] Security lights
- [ ] Smart doorbell — Qty: 1

<!-- section: plumbing -->
## 3. Plumbing Hardware Fixtures
- [ ] Soap dispenser
- [ ] Garbage disposal
`;

const LOT_37_INITIAL_DOC = `# Master Purchasing List - Lot 37 (Custom Build)
DocumentId: doc_lot_37_secure_uuid

<!-- section: quartz -->
## Quartz Countertop Package
- [ ] Sink cutout brackets

<!-- section: electrical -->
## Electrical Package & Prewire
- [ ] 200A Main Panel Breaker
- [ ] Can lights — Qty: 12

<!-- section: plumbing -->
## Plumbing Rough-In & Fixtures
- [ ] Tankless water heater
- [ ] Shower valve rough-in
`;

const LOT_55_INITIAL_DOC = `# Purchasing Checklist - Lot 55
DocumentId: doc_lot_55_secure_uuid

<!-- section: electrical -->
## Electrical Materials
- [ ] Exterior column lights
`;

describe('Cross-Project Isolation & Stable ID Hierarchy Suite', () => {
  beforeEach(async () => {
    localStorage.clear();
    if (purchasingService?.storage?.memoryStore?.clear) {
      purchasingService.storage.memoryStore.clear();
    }
    saveProjectPurchasingDoc(localStorage, 'lot_3', LOT_3_INITIAL_DOC);
    saveProjectPurchasingDoc(localStorage, 'lot_37', LOT_37_INITIAL_DOC);
    saveProjectPurchasingDoc(localStorage, 'lot_55', LOT_55_INITIAL_DOC);
    await purchasingService.migrateFromGoogleDocContent('lot_3', LOT_3_INITIAL_DOC);
    await purchasingService.migrateFromGoogleDocContent('lot_37', LOT_37_INITIAL_DOC);
    await purchasingService.migrateFromGoogleDocContent('lot_55', LOT_55_INITIAL_DOC);
    resetActiveSessionCognitiveState();
  });

  test('1. Strict Storage Scoping: Each project has a distinct isolated storage key', () => {
    assert.equal(getPurchasingDocStorageKey('lot_3'), 'sitetactix_purchasing_doc_lot_3');
    assert.equal(getPurchasingDocStorageKey('lot_37'), 'sitetactix_purchasing_doc_lot_37');
    assert.equal(getPurchasingDocStorageKey('lot_55'), 'sitetactix_purchasing_doc_lot_55');

    const lot3Doc = loadProjectPurchasingDoc(localStorage, 'lot_3');
    const lot37Doc = loadProjectPurchasingDoc(localStorage, 'lot_37');
    
    assert.ok(lot3Doc.includes('doc_lot_3_secure_uuid'));
    assert.ok(lot37Doc.includes('doc_lot_37_secure_uuid'));
    assert.ok(!lot3Doc.includes('Tankless water heater'), 'Lot 3 must not contain Lot 37 items');
    assert.ok(!lot37Doc.includes('Smart doorbell'), 'Lot 37 must not contain Lot 3 items');
  });

  test('2. get_purchasing_list respects active project context automatically', async () => {
    // When active project is Lot 37
    const projectContextLot37 = { projectId: 'lot_37' };
    const res37 = await executeClientToolCall('get_purchasing_list', { trade: 'plumbing' }, projectContextLot37);
    
    assert.equal(res37.projectId, 'lot_37');
    assert.equal(res37.totalItems, 2);
    assert.equal(res37.sections[0].items[0].name, 'Tankless water heater');
    assert.equal(res37.sections[0].items[1].name, 'Shower valve rough-in');

    // When active project is Lot 3
    const projectContextLot3 = { projectId: 'lot_3' };
    const res3 = await executeClientToolCall('get_purchasing_list', { trade: 'plumbing' }, projectContextLot3);
    
    assert.equal(res3.projectId, 'lot_3');
    assert.equal(res3.totalItems, 2);
    assert.equal(res3.sections[0].items[0].name, 'Soap dispenser');
    assert.equal(res3.sections[0].items[1].name, 'Garbage disposal');
  });

  test('3. add_purchasing_item modifies ONLY the targeted project document', async () => {
    // Add 4 GFCI outlets to active project Lot 37
    const projectContextLot37 = { projectId: 'lot_37' };
    const addRes = await executeClientToolCall('add_purchasing_item', { item: 'GFCI outlets', quantity: 4 }, projectContextLot37);
    
    assert.equal(addRes.success, true);
    assert.equal(addRes.projectId, 'lot_37');

    const lot37Doc = loadProjectPurchasingDoc(localStorage, 'lot_37');
    const lot3Doc = loadProjectPurchasingDoc(localStorage, 'lot_3');
    const lot55Doc = loadProjectPurchasingDoc(localStorage, 'lot_55');

    assert.ok(lot37Doc.includes('GFCI outlets — Qty: 4'), 'Lot 37 must have new item');
    assert.ok(!lot3Doc.includes('GFCI outlets'), 'Lot 3 must NOT be modified');
    assert.ok(!lot55Doc.includes('GFCI outlets'), 'Lot 55 must NOT be modified');
  });

  test('4. Stable section_id targeting survives arbitrary heading renames', () => {
    // In Lot 37, heading is "## Electrical Package & Prewire" with "<!-- section: electrical -->"
    const parsed37 = parseGoogleDocPurchasingStructure(LOT_37_INITIAL_DOC);
    const electricalSection = parsed37.sections.find(s => s.sectionId === 'electrical');

    assert.ok(electricalSection, 'Must find section by stable sectionId: electrical');
    assert.equal(electricalSection.title, 'Electrical Package & Prewire');

    // Insertion targeting uses section_id
    const insertion = calculateSectionInsertion(parsed37, 'dimmer switches', 2);
    assert.equal(insertion.category.id, 'electrical');
    assert.equal(insertion.action, 'INSERT_ITEM');
  });

  test('5. Document title rename does not break project document targeting', () => {
    const renamedLot3Doc = `# Lot 3 Custom Purchasing Manifest (Renamed by Builder)
DocumentId: doc_lot_3_secure_uuid

<!-- section: electrical -->
## Electrical Gear
- [ ] Security lights
`;
    saveProjectPurchasingDoc(localStorage, 'lot_3', renamedLot3Doc);

    const parsed = parseGoogleDocPurchasingStructure(renamedLot3Doc);
    assert.equal(parsed.sections.length, 1);
    assert.equal(parsed.sections[0].sectionId, 'electrical');

    const insertion = calculateSectionInsertion(parsed, 'dimmer switches', 2);
    assert.equal(insertion.category.id, 'electrical');
    assert.equal(insertion.action, 'INSERT_ITEM');
  });

  test('6. Explicit projectId parameter overrides active project when specified', async () => {
    // Active project is Lot 3, but user explicitly said "for Lot 55"
    const projectContextLot3 = { projectId: 'lot_3' };
    const res = await executeClientToolCall('add_purchasing_item', { 
      item: 'smart thermostat', 
      projectId: 'lot_55' 
    }, projectContextLot3);

    assert.equal(res.projectId, 'lot_55');

    const lot55Doc = loadProjectPurchasingDoc(localStorage, 'lot_55');
    const lot3Doc = loadProjectPurchasingDoc(localStorage, 'lot_3');

    assert.ok(lot55Doc.includes('smart thermostat'), 'Lot 55 must receive the item');
    assert.ok(!lot3Doc.includes('smart thermostat'), 'Lot 3 must NOT receive the item');
  });

  test('7. Real User Perspective Scenario: Active Lot 3 query -> Switch to Active Lot 37 query -> Add GFCI outlets to Lot 37 only', async () => {
    // Step 1: Active Lot 3 queries plumbing
    const ctxLot3 = { projectId: 'lot_3' };
    const queryLot3 = await executeClientToolCall('get_purchasing_list', { trade: 'plumbing' }, ctxLot3);
    assert.equal(queryLot3.projectId, 'lot_3');
    assert.equal(queryLot3.sections[0].items.length, 2);
    assert.ok(queryLot3.sections[0].items.some(i => i.name === 'Soap dispenser'));
    assert.ok(!queryLot3.sections[0].items.some(i => i.name === 'Tankless water heater'), 'Lot 3 must NOT contain Lot 37 items');

    // Step 2: Switch context to Active Lot 37 queries plumbing
    const ctxLot37 = { projectId: 'lot_37' };
    const queryLot37 = await executeClientToolCall('get_purchasing_list', { trade: 'plumbing' }, ctxLot37);
    assert.equal(queryLot37.projectId, 'lot_37');
    assert.equal(queryLot37.sections[0].items.length, 2);
    assert.ok(queryLot37.sections[0].items.some(i => i.name === 'Tankless water heater'));
    assert.ok(!queryLot37.sections[0].items.some(i => i.name === 'Soap dispenser'), 'Lot 37 must NOT contain Lot 3 items');

    // Step 3: Add two GFCI outlets while Lot 37 is active
    const addLot37 = await executeClientToolCall('add_purchasing_item', { item: 'GFCI outlets', quantity: 2 }, ctxLot37);
    assert.equal(addLot37.success, true);
    assert.equal(addLot37.projectId, 'lot_37');

    // Step 4: Verify Lot 37 received the items, and Lot 3 is untouched
    const lot37DocAfter = loadProjectPurchasingDoc(localStorage, 'lot_37');
    const lot3DocAfter = loadProjectPurchasingDoc(localStorage, 'lot_3');

    assert.ok(lot37DocAfter.includes('GFCI outlets — Qty: 2'), 'Lot 37 doc MUST contain GFCI outlets');
    assert.ok(!lot3DocAfter.includes('GFCI outlets'), 'Lot 3 doc MUST NOT contain GFCI outlets');
  });

  test('8. Missing document safety: Never falls back to another lot if active project doc is empty/missing', async () => {
    // Project 4 (Lot 59) has no doc saved yet
    const ctxLot59 = { projectId: 'lot_59' };
    const res59 = await executeClientToolCall('get_purchasing_list', { trade: 'plumbing' }, ctxLot59);
    
    assert.equal(res59.projectId, 'lot_59');
    // It must return 0 items for lot 59, never leaking lot 3 or lot 37 items
    assert.equal(res59.totalItems, 0);
  });
});
