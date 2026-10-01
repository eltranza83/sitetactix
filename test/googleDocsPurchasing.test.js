import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADE_CATEGORIES,
  classifyTradeCategory,
  parseQuantity,
  parseGoogleDocPurchasingStructure,
  calculateSectionInsertion,
  calculateMarkPurchased,
  calculateRemoveItem,
  calculateRemoveSection,
  queryPurchasingList
} from '../src/services/googleDocsPurchasingService.js';

const SAMPLE_PURCHASING_DOC = `# Master Fixtures & Hardware Purchasing Checklist
Applicable to all lots and standard builds.

## 1. Quartz Hardware
- [ ] Electrical pass-through caps
- [ ] Sinks

## 2. Electrical Hardware Fixtures
- [ ] Security lights
- [ ] Contractor's doorbell chime kit
- [ ] Smart doorbell
- [ ] Front porch hanging light
- [ ] Exterior column lights
- [ ] Garage ceiling lights with the cap to install it
- [ ] Vanity lights
- [ ] Smart switches
- [ ] Extension rods
- [ ] Ceiling fans

## 3. Plumbing Hardware Fixtures
- [ ] Soap dispenser
- [ ] Garbage disposal power button
- [ ] Garbage disposal
- [ ] Water heater with the water heater stand and tray
- [ ] Shower kits
- [ ] Toilets
- [ ] Rough-in shower valves
- [ ] Faucets
`;

describe('Google Docs Master Purchasing List Service Suite', () => {
  test('1. Parses multi-trade sections and checklist items accurately', () => {
    const parsed = parseGoogleDocPurchasingStructure(SAMPLE_PURCHASING_DOC);
    assert.equal(parsed.sections.length, 3, 'Must parse exactly 3 sections');
    
    const quartz = parsed.sections.find(s => s.categoryId === 'quartz');
    const electrical = parsed.sections.find(s => s.categoryId === 'electrical');
    const plumbing = parsed.sections.find(s => s.categoryId === 'plumbing');

    assert.ok(quartz, 'Must have Quartz section');
    assert.equal(quartz.items.length, 2, 'Quartz has 2 items');

    assert.ok(electrical, 'Must have Electrical section');
    assert.equal(electrical.items.length, 10, 'Electrical has 10 items');

    assert.ok(plumbing, 'Must have Plumbing section');
    assert.equal(plumbing.items.length, 8, 'Plumbing has 8 items');
  });

  test('2. Automatic trade classification works for unstated trades', () => {
    assert.equal(classifyTradeCategory('shower pan liner').id, 'plumbing');
    assert.equal(classifyTradeCategory('four hole grommets').id, 'quartz');
    assert.equal(classifyTradeCategory('GFCI outlets').id, 'electrical');
    assert.equal(classifyTradeCategory('smart thermostat'), null);
    assert.equal(classifyTradeCategory('drywall joint compound'), null);
  });

  test('3. Explicit trade override takes priority over keyword matching', () => {
    const cat1 = classifyTradeCategory('support brackets', 'quartz');
    assert.equal(cat1.id, 'quartz');

    const cat2 = classifyTradeCategory('support brackets', 'plumbing');
    assert.equal(cat2.id, 'plumbing');
  });

  test('4. Section-aware insertion targets the end of the correct section', () => {
    const parsed = parseGoogleDocPurchasingStructure(SAMPLE_PURCHASING_DOC);
    const electrical = parsed.sections.find(s => s.categoryId === 'electrical');
    const plumbing = parsed.sections.find(s => s.categoryId === 'plumbing');

    // Add new electrical item
    const insertion = calculateSectionInsertion(parsed, 'dimmer switches', 2);
    assert.equal(insertion.action, 'INSERT_ITEM');
    assert.equal(insertion.category.id, 'electrical');
    assert.ok(insertion.insertionIndex <= plumbing.startIndex, 'Must insert before plumbing section begins');
    assert.ok(insertion.textToInsert.includes('dimmer switches — Qty: 2'));
  });

  test('5. Duplicate detection increments quantity autonomously', () => {
    const parsed = parseGoogleDocPurchasingStructure(SAMPLE_PURCHASING_DOC);
    
    // Add existing item: "Smart doorbell"
    const duplicateInsertion = calculateSectionInsertion(parsed, 'Smart doorbell', 2);
    assert.equal(duplicateInsertion.action, 'UPDATE_QUANTITY');
    assert.equal(duplicateInsertion.isDuplicate, true);
    assert.equal(duplicateInsertion.newQuantity, 3, '1 existing + 2 new = 3');
    assert.ok(duplicateInsertion.replacementText.includes('Smart doorbell — Qty: 3'));
  });

  test('6. Marking items purchased toggles [x] without deleting line', () => {
    const parsed = parseGoogleDocPurchasingStructure(SAMPLE_PURCHASING_DOC);
    
    const markRes = calculateMarkPurchased(parsed, 'soap dispenser', true);
    assert.equal(markRes.found, true);
    assert.ok(markRes.replacementText.includes('- [x] Soap dispenser'));
    assert.equal(markRes.category.categoryId, 'plumbing');
  });

  test('7. Querying purchasing list filters by trade and unpurchased status', () => {
    const parsed = parseGoogleDocPurchasingStructure(SAMPLE_PURCHASING_DOC);
    
    // Query electrician only
    const electricalItems = queryPurchasingList(parsed, { trade: 'electrician', unpurchasedOnly: true });
    assert.equal(electricalItems.length, 1);
    assert.equal(electricalItems[0].items.length, 10);
    assert.equal(electricalItems[0].category, 'Electrical Hardware Fixtures');

    // Query plumbing only
    const plumbingItems = queryPurchasingList(parsed, { trade: 'plumbing', unpurchasedOnly: true });
    assert.equal(plumbingItems.length, 1);
    assert.equal(plumbingItems[0].items.length, 8);
  });

  test('8. Resilient to section heading renaming', () => {
    const docWithRenamedHeadings = `# Master Purchasing List

## Quartz Package
- [ ] Electrical pass-through caps

## Electrical Wiring & Lighting
- [ ] Security lights

## Plumbing Package
- [ ] Toilets
`;
    const parsed = parseGoogleDocPurchasingStructure(docWithRenamedHeadings);
    assert.equal(parsed.sections.length, 3);
    assert.equal(parsed.sections[0].categoryId, 'quartz');
    assert.equal(parsed.sections[1].categoryId, 'electrical');
    assert.equal(parsed.sections[2].categoryId, 'plumbing');

    const insertion = calculateSectionInsertion(parsed, 'two dimmer switches');
    assert.equal(insertion.category.id, 'electrical');
    assert.equal(insertion.action, 'INSERT_ITEM');
  });

  test('9. Natural language quantity extraction', () => {
    const p1 = parseQuantity('four GFCI outlets');
    assert.equal(p1.quantity, 4);
    assert.equal(p1.itemName, 'GFCI outlets');

    const p2 = parseQuantity('add two more ceiling fans');
    assert.equal(p2.quantity, 2);
    assert.equal(p2.itemName, 'ceiling fans');

    const p3 = parseQuantity('Smart switches — Qty: 6');
    assert.equal(p3.quantity, 6);
    assert.equal(p3.itemName, 'Smart switches');
  });

  test('10. calculateRemoveItem cleanly removes an item line from Google Doc structure', () => {
    const docWithRedBulb = `# Master Purchasing Checklist
## 1. Electrical Hardware Fixtures
- [ ] Security lights
- [ ] red light bulb
- [ ] Smart doorbell
`;
    const parsed = parseGoogleDocPurchasingStructure(docWithRedBulb);
    const removeRes = calculateRemoveItem(parsed, 'red light bulb');
    assert.ok(removeRes.found);
    assert.equal(removeRes.item.itemName, 'red light bulb');

    const before = docWithRedBulb.slice(0, removeRes.replaceRange.startIndex);
    const after = docWithRedBulb.slice(removeRes.replaceRange.endIndex);
    const updated = before + removeRes.replacementText + after;

    assert.ok(!updated.includes('red light bulb'));
    assert.ok(updated.includes('Security lights'));
    assert.ok(updated.includes('Smart doorbell'));
  });

  test('11. calculateRemoveSection cleanly removes an entire heading and its contents', () => {
    const docWithExtraSection = `# Master Purchasing Checklist
## 1. Quartz Hardware
- [ ] Pass-through caps

## 2. Electrical Hardware Fixtures
- [ ] Security lights
- [ ] Dimmer switches

## 3. Plumbing Hardware Fixtures
- [ ] Toilets
`;
    const parsed = parseGoogleDocPurchasingStructure(docWithExtraSection);
    const removeRes = calculateRemoveSection(parsed, 'electrical hardware fixtures');
    assert.ok(removeRes.found);
    assert.match(removeRes.section.title, /Electrical Hardware Fixtures/i);

    const before = docWithExtraSection.slice(0, removeRes.replaceRange.startIndex);
    const after = docWithExtraSection.slice(removeRes.replaceRange.endIndex);
    const updated = before + removeRes.replacementText + after;

    assert.ok(!updated.includes('Electrical Hardware Fixtures'));
    assert.ok(!updated.includes('Security lights'));
    assert.ok(updated.includes('Quartz Hardware'));
    assert.ok(updated.includes('Plumbing Hardware Fixtures'));
  });
});
