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
  toCanonicalProjectId,
  resolveTargetProjectId,
  generateItemId
} from '../src/services/googleDocsPurchasingService.js';

import {
  purchasingService,
  PurchasingService,
  LocalStoragePurchasingAdapter,
  PURCHASING_STATUSES
} from '../src/services/purchasingService.js';

import { executeClientToolCall } from '../src/services/aiTools.js';
import { synthesizeGroundedEvidence } from '../src/services/semanticIntentService.js';
import {
  normalizePurchasingToolCalls,
  isPurchaseStatusMutationCommand,
  extractPurchasingSubjectFromQuery,
  verifyResponseGrounding,
  formatToolResultsHumanReadable
} from '../src/services/builderBrainService.js';
import { extractTextFromDocxBytes } from '../src/services/googleDrive.js';
import * as fflate from 'fflate';

describe('Project Purchasing Lifecycle & Identity Architecture Suite', () => {

  beforeEach(() => {
    localStorage.clear();
    if (purchasingService.storage?.memoryStore?.clear) {
      purchasingService.storage.memoryStore.clear();
    }
  });

  test('1. Canonical Project ID Resolution Normalization', () => {
    assert.equal(toCanonicalProjectId('Lot 55'), 'lot_55');
    assert.equal(toCanonicalProjectId('lot 55'), 'lot_55');
    assert.equal(toCanonicalProjectId('lot-55'), 'lot_55');
    assert.equal(toCanonicalProjectId('LOT_55'), 'lot_55');
    assert.equal(toCanonicalProjectId('Lot 3'), 'lot_3');
    assert.equal(toCanonicalProjectId('Lot 3B'), 'lot_3b');
    assert.equal(toCanonicalProjectId('Westlake Commercial Lot 12'), 'westlake_commercial_lot_12');
    assert.equal(toCanonicalProjectId('master'), 'master');
    assert.equal(toCanonicalProjectId('purchasing_master'), 'master');

    const context = {
      activeProject: { id: 'proj_1740999', name: 'Lot 55' },
      activeProjectName: 'Lot 55',
      projects: [{ id: 'proj_1740999', name: 'Lot 55' }]
    };

    assert.equal(resolveTargetProjectId('Lot 55', context), 'lot_55');
    assert.equal(resolveTargetProjectId('lot_55', context), 'lot_55');
    assert.equal(resolveTargetProjectId('proj_1740999', context), 'lot_55');
    assert.equal(resolveTargetProjectId(null, context), 'lot_55');
  });

  test('2. Deterministic Item IDs with Category Scoping', () => {
    const quartzCapId = generateItemId('Pass-through caps', 'quartz');
    const electricalCapId = generateItemId('Pass-through caps', 'electrical');

    assert.equal(quartzCapId, 'item_quartz_pass_through_caps');
    assert.equal(electricalCapId, 'item_electrical_pass_through_caps');
    assert.notEqual(quartzCapId, electricalCapId, 'Cross-trade identical item names must not collide');

    // Existing item ID preservation
    const existingItem = { id: 'legacy_cap_id_123', itemName: 'Pass-through caps' };
    const preservedId = generateItemId('Pass-through caps', 'quartz', existingItem);
    assert.equal(preservedId, 'legacy_cap_id_123', 'Must preserve existing item ID');
  });

  test('3. Idempotent Google Doc Ingestion & Metadata Sentinel', async () => {
    const testAdapter = new LocalStoragePurchasingAdapter();
    const service = new PurchasingService(testAdapter);
    const testProj = 'lot_99_test';
    const sampleDoc = `# Master Fixtures & Hardware Purchasing Checklist - Lot 99
## 1. Quartz Hardware
- [ ] Undermount sink clips — Qty: 4
- [x] Pass-through hole caps

## 2. Electrical Hardware Fixtures
- [ ] Security floodlights — Qty: 2
- [ ] Smart doorbell
`;

    assert.equal(await service.isProjectInitialized(testProj), false);

    const res1 = await service.migrateFromGoogleDocContent(testProj, sampleDoc, {
      sourceDocId: 'doc_lot99_test',
      sourceDocName: 'Lot 99 Purchasing Checklist'
    });

    assert.equal(res1.success, true);
    assert.equal(res1.count, 4);
    assert.equal(await service.isProjectInitialized(testProj), true);

    const meta = await testAdapter.getMetadata(testProj);
    assert.equal(meta.initialized, true);
    assert.equal(meta.sourceDocId, 'doc_lot99_test');

    // Repeated import must produce 0 duplicate items
    const res2 = await service.migrateFromGoogleDocContent(testProj, sampleDoc, {
      sourceDocId: 'doc_lot99_test',
      sourceDocName: 'Lot 99 Purchasing Checklist'
    });

    assert.equal(res2.count, 4);
    const items = await service.getItems(testProj);
    assert.equal(items.length, 4);
  });

  test('4. Strict Error Guard: Unreadable Drive Doc Reports Error and NEVER Silently Populates Master', async () => {
    const testProj = 'lot_unreadable_test';
    const projectContext = {
      projectId: testProj,
      activeProjectName: 'Lot Unreadable Test',
      googleToken: 'mock_expired_token',
      driveTree: {
        folders: [
          {
            name: 'Google Docs Purchasing List',
            files: [
              { id: 'unreadable_file_123', name: 'Purchasing Checklist - Lot Unreadable', mimeType: 'application/vnd.google-apps.document' }
            ]
          }
        ]
      }
    };

    const result = await executeClientToolCall('get_purchasing_list', {
      projectId: testProj,
      initializeIfMissing: true
    }, projectContext);

    assert.equal(result.success, false);
    assert.equal(result.readError, true);
    assert.match(result.message, /unable to retrieve its contents/i);

    const itemsInStore = await purchasingService.getItems(testProj);
    assert.equal(itemsInStore.length, 0, 'Must NOT populate master template items when project doc is unreadable');
  });

  test('5. Live Ingestion Lifecycle for Newly Recreated Lot (e.g. Lot 55)', async () => {
    const testProj = 'lot_55';
    const projectContext = {
      projectId: testProj,
      activeProjectName: 'Lot 55',
      ['lot_55']: {
        purchasingDocContent: `# Master Fixtures & Hardware Purchasing Checklist - Lot 55
## 1. Quartz Hardware
- [ ] Quartz pass-through caps (2)

## 2. Electrical Hardware Fixtures
- [ ] Smart switches — Qty: 8
- [ ] Garage ceiling lights
- [x] Security lights

## 3. Plumbing Hardware Fixtures
- [ ] Kitchen sink faucet
- [ ] Soap dispenser
`
      }
    };

    const toolRes = await executeClientToolCall('get_purchasing_list', {
      projectId: 'Lot 55',
      unpurchasedOnly: true,
      initializeIfMissing: true
    }, projectContext);

    assert.equal(toolRes.found, true);
    assert.equal(toolRes.totalPurchased, 1);
    assert.equal(toolRes.totalItems, 5);

    const synth = synthesizeGroundedEvidence([{ name: 'get_purchasing_list', success: true, result: toolRes }], 'What do we still need to purchase for Lot 55?', projectContext);
    assert.match(synth, /You still have 5 items to purchase for Lot 55/i);
    assert.match(synth, /You have 1 item marked as purchased/i);

    const itemStatusSynth = synthesizeGroundedEvidence([{ name: 'get_purchasing_list', success: true, result: toolRes }], 'Did we already buy the security lights?', projectContext);
    assert.match(itemStatusSynth, /Yes\. The Security lights are marked as purchased on Lot 55\./i);
  });

  test('6. Lot 3 Preservation: Lot 3 remains intact with 20 items', async () => {
    await purchasingService.initializeProjectFromMaster('lot_3');
    const projectContext = { projectId: 'lot_3', activeProjectName: 'Lot 3' };
    const res = await executeClientToolCall('get_purchasing_list', {
      projectId: 'lot_3'
    }, projectContext);

    assert.equal(res.found, true);
    assert.ok(res.totalItems >= 19, 'Lot 3 must retain its full checklist');
  });

  test('7. Real Binary .docx OpenXML In-Memory Extraction & Checkbox Normalization', () => {
    // Construct authentic OpenXML word/document.xml with mixed checkboxes & headings
    const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p><w:r><w:t>Master Fixtures &amp; Hardware Purchasing Checklist - Lot 55</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Quartz Hardware</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Quartz pass-through caps (2)</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Undermount sink clips — Qty: 4</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Electrical Hardware Fixtures</w:t></w:r></w:p>
    <w:p>
      <w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr>
      <w:sdtContent><w:p><w:r><w:t>Security lights</w:t></w:r></w:p></w:sdtContent></w:sdt>
    </w:p>
    <w:p><w:r><w:t>☐ Smart switches — Qty: 8</w:t></w:r></w:p>
    <w:p><w:r><w:t>☑ Garage ceiling lights</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Plumbing Hardware Fixtures</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Kitchen sink faucet</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Soap dispenser</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const docxZipBytes = fflate.zipSync({
      'word/document.xml': fflate.strToU8(wordXml),
      '[Content_Types].xml': fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    });

    assert.ok(docxZipBytes instanceof Uint8Array);
    assert.equal(docxZipBytes[0], 0x50); // PK
    assert.equal(docxZipBytes[1], 0x4b);

    const extractedText = extractTextFromDocxBytes(docxZipBytes);
    assert.ok(extractedText, 'Must successfully extract text from binary .docx');
    assert.match(extractedText, /## 1\. Quartz Hardware/);
    assert.match(extractedText, /- \[ \] Quartz pass-through caps \(2\)/);
    assert.match(extractedText, /- \[x\] Security lights/);
    assert.match(extractedText, /- \[ \] Smart switches — Qty: 8/);
    assert.match(extractedText, /- \[x\] Garage ceiling lights/);
    assert.match(extractedText, /- \[ \] Kitchen sink faucet/);
  });

  test('8. Real-World Lot 55 End-to-End: Binary Purchasing Checklist.docx Ingestion to Live Synthesis', async () => {
    const lot55Proj = 'lot_55';
    
    // Construct real binary .docx for Lot 55
    const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p><w:r><w:t>Master Fixtures &amp; Hardware Purchasing Checklist - Lot 55</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Quartz Hardware</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Quartz pass-through caps (2)</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Electrical Hardware Fixtures</w:t></w:r></w:p>
    <w:p><w:r><w:t>☑ Security lights</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Smart switches — Qty: 8</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Plumbing Hardware Fixtures</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Kitchen sink faucet</w:t></w:r></w:p>
    <w:p><w:r><w:t>☐ Soap dispenser</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const docxZipBytes = fflate.zipSync({
      'word/document.xml': fflate.strToU8(wordXml)
    });

    const extractedText = extractTextFromDocxBytes(docxZipBytes);
    
    // Simulate Lot 55 project context with discovered .docx file in Drive tree
    const projectContext = {
      projectId: lot55Proj,
      activeProjectName: 'Lot 55',
      ['lot_55']: {
        purchasingDocContent: extractedText
      },
      driveTree: {
        folders: [
          {
            name: 'Google Docs Purchasing List',
            files: [
              {
                id: 'file_lot55_docx_real',
                name: 'Purchasing Checklist.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              }
            ]
          }
        ]
      }
    };

    // 1. Initial query executes JIT ingestion
    const toolRes = await executeClientToolCall('get_purchasing_list', {
      projectId: 'Lot 55',
      unpurchasedOnly: true,
      initializeIfMissing: true
    }, projectContext);

    assert.equal(toolRes.found, true);
    assert.equal(toolRes.totalPurchased, 1);
    assert.equal(toolRes.totalNeeded, 4);
    assert.equal(toolRes.totalItems, 4); // unpurchased only

    // 2. Synthesize broad purchasing question
    const synth = synthesizeGroundedEvidence(
      [{ name: 'get_purchasing_list', success: true, result: toolRes }],
      'What do we still need to purchase for Lot 55?',
      projectContext
    );
    assert.match(synth, /You still have 4 items to purchase for Lot 55/i);
    assert.match(synth, /You have 1 item marked as purchased/i);

    // 3. Synthesize single-item status question
    const itemStatusSynth = synthesizeGroundedEvidence(
      [{ name: 'get_purchasing_list', success: true, result: toolRes }],
      'Did we already buy the security lights?',
      projectContext
    );
    assert.match(itemStatusSynth, /Yes\. The Security lights are marked as purchased on Lot 55\./i);

    // 4. Verify Firestore sentinel was written
    const isInit = await purchasingService.isProjectInitialized(lot55Proj);
    assert.equal(isInit, true, 'Sentinel metadata must be initialized');
  });

  test('9. Anti-Double-Subtraction & Authoritative Purchasing Numerical Integrity Guard', async () => {
    const lotId = 'lot_55_numerical_guard';
    
    // 1. Initial 20-item checklist (2 Quartz, 10 Electrical, 8 Plumbing)
    const masterItems = [
      // 2 Quartz
      { id: 'item_quartz_1', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Electrical pass-through caps', status: 'needed', quantity: 1 },
      { id: 'item_quartz_2', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Sinks', status: 'needed', quantity: 1 },
      // 10 Electrical
      { id: 'item_elec_1', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Security lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_2', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Contractor doorbell chime kit', status: 'needed', quantity: 1 },
      { id: 'item_elec_3', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart doorbell', status: 'needed', quantity: 1 },
      { id: 'item_elec_4', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Front porch hanging light', status: 'needed', quantity: 1 },
      { id: 'item_elec_5', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Exterior column lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_6', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Garage ceiling lights with the cap to install it', status: 'needed', quantity: 1 },
      { id: 'item_elec_7', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Vanity lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_8', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart switches', status: 'needed', quantity: 8 },
      { id: 'item_elec_9', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Extension rods', status: 'needed', quantity: 1 },
      { id: 'item_elec_10', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Ceiling fans', status: 'needed', quantity: 1 },
      // 8 Plumbing
      { id: 'item_plumb_1', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Soap dispenser', status: 'needed', quantity: 1 },
      { id: 'item_plumb_2', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal power button', status: 'needed', quantity: 1 },
      { id: 'item_plumb_3', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal', status: 'needed', quantity: 1 },
      { id: 'item_plumb_4', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Water heater with the water heater stand and tray', status: 'needed', quantity: 1 },
      { id: 'item_plumb_5', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Shower kits', status: 'needed', quantity: 1 },
      { id: 'item_plumb_6', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Toilets', status: 'needed', quantity: 1 },
      { id: 'item_plumb_7', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Rough-in shower valves', status: 'needed', quantity: 1 },
      { id: 'item_plumb_8', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Faucets', status: 'needed', quantity: 1 }
    ];

    await purchasingService.initializeProjectFromMaster(lotId, masterItems);

    const projectContext = {
      projectId: lotId,
      activeProjectName: 'Lot 55'
    };

    // 2. Mark Security lights as purchased
    const markRes = await executeClientToolCall('update_purchasing_item_status', {
      projectId: lotId,
      itemName: 'Security lights',
      isPurchased: true
    }, projectContext);
    assert.equal(markRes.success, true);

    // 3. Broad query execution
    const broadToolRes = await executeClientToolCall('get_purchasing_list', {
      projectId: lotId,
      unpurchasedOnly: true
    }, projectContext);

    // Assert authoritative summary block math
    assert.equal(broadToolRes.summary.neededCount, 19);
    assert.equal(broadToolRes.summary.purchasedCount, 1);
    assert.equal(broadToolRes.summary.totalChecklistCount, 20);
    assert.equal(broadToolRes.summary.tradeBreakdown['Quartz Hardware'].needed, 2);
    assert.equal(broadToolRes.summary.tradeBreakdown['Electrical Hardware Fixtures'].needed, 9);
    assert.equal(broadToolRes.summary.tradeBreakdown['Electrical Hardware Fixtures'].purchased, 1);
    assert.equal(broadToolRes.summary.tradeBreakdown['Electrical Hardware Fixtures'].total, 10);
    assert.equal(broadToolRes.summary.tradeBreakdown['Plumbing Hardware Fixtures'].needed, 8);

    // Assert canonical answer formulation
    assert.match(broadToolRes.summary.canonicalAnswer, /You still have 19 items to purchase for Lot 55: 2 Quartz Hardware, 9 Electrical Hardware Fixtures, and 8 Plumbing Hardware Fixtures\./i);
    assert.match(broadToolRes.summary.canonicalAnswer, /You have 1 item marked as purchased\./i);

    // 4. Trade-specific query execution
    const elecToolRes = await executeClientToolCall('get_purchasing_list', {
      projectId: lotId,
      trade: 'electrical',
      unpurchasedOnly: true
    }, projectContext);
    assert.equal(elecToolRes.totalItems, 9, 'Electrical unpurchased items must be 9, never 8');
    assert.equal(elecToolRes.items.length, 9);

    // 5. Test Numerical Integrity Guard against hallucinated/double-subtracted text
    const hallucinatedText = 'You still have 18 items to purchase for Lot 55: 2 Quartz Hardware, 8 Electrical Hardware Fixtures, and 8 Plumbing Hardware Fixtures. You have 1 item marked as purchased.';
    const toolTelemetry = [{ name: 'get_purchasing_list', success: true, result: broadToolRes, data: broadToolRes }];
    
    const { verifyResponseGrounding } = await import('../src/services/builderBrainService.js');
    const groundingReport = verifyResponseGrounding(hallucinatedText, projectContext, toolTelemetry);
    
    assert.equal(groundingReport.purchasingDiscrepancyDetected, true, 'Guard must detect double-subtracted 18 and 8');
    assert.match(groundingReport.suggestedCorrection, /19 items/i);
    assert.match(groundingReport.suggestedCorrection, /9 Electrical/i);

    // 6. Test Numerical Integrity Guard against verified correct text
    const accurateText = 'You still have 19 items to purchase for Lot 55: 2 Quartz Hardware, 9 Electrical Hardware Fixtures, and 8 Plumbing Hardware Fixtures. You have 1 item marked as purchased.';
    const accurateReport = verifyResponseGrounding(accurateText, projectContext, toolTelemetry);
    assert.equal(accurateReport.purchasingDiscrepancyDetected, false, 'Guard must NOT flag mathematically accurate text');

    // 7. Edge Cases: All purchased (100% complete)
    for (const it of masterItems) {
      await purchasingService.updateItemStatus(lotId, it.itemName, PURCHASING_STATUSES.PURCHASED);
    }
    const allPurchasedRes = await executeClientToolCall('get_purchasing_list', {
      projectId: lotId,
      unpurchasedOnly: true
    }, projectContext);
    assert.equal(allPurchasedRes.summary.neededCount, 0);
    assert.equal(allPurchasedRes.summary.purchasedCount, 20);
    assert.match(allPurchasedRes.summary.canonicalAnswer, /All 20 items have been purchased for Lot 55\./i);
  });

  test('10. 3-Way Item Resolution Engine & Zero-Write Safety Gate on Ambiguity and Non-Existence', async () => {
    const lotId = 'lot_55_safety_gate';
    
    // Initial 20-item checklist (includes 5 light fixtures)
    const masterItems = [
      { id: 'item_quartz_1', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Electrical pass-through caps', status: 'needed', quantity: 1 },
      { id: 'item_quartz_2', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Sinks', status: 'needed', quantity: 1 },
      // 5 distinct light fixtures
      { id: 'item_elec_1', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Security lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_4', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Front porch hanging light', status: 'needed', quantity: 1 },
      { id: 'item_elec_5', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Exterior column lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_6', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Garage ceiling lights with the cap to install it', status: 'needed', quantity: 1 },
      { id: 'item_elec_7', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Vanity lights', status: 'needed', quantity: 1 },
      // Other electrical & plumbing
      { id: 'item_elec_2', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Contractor doorbell chime kit', status: 'needed', quantity: 1 },
      { id: 'item_elec_3', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart doorbell', status: 'needed', quantity: 1 },
      { id: 'item_elec_8', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart switches', status: 'needed', quantity: 8 },
      { id: 'item_elec_9', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Extension rods', status: 'needed', quantity: 1 },
      { id: 'item_elec_10', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Ceiling fans', status: 'needed', quantity: 1 },
      { id: 'item_plumb_1', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Soap dispenser', status: 'needed', quantity: 1 },
      { id: 'item_plumb_2', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal power button', status: 'needed', quantity: 1 },
      { id: 'item_plumb_3', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal', status: 'needed', quantity: 1 },
      { id: 'item_plumb_4', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Water heater with the water heater stand and tray', status: 'needed', quantity: 1 },
      { id: 'item_plumb_5', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Shower kits', status: 'needed', quantity: 1 },
      { id: 'item_plumb_6', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Toilets', status: 'needed', quantity: 1 },
      { id: 'item_plumb_7', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Rough-in shower valves', status: 'needed', quantity: 1 },
      { id: 'item_plumb_8', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Faucets', status: 'needed', quantity: 1 }
    ];

    await purchasingService.initializeProjectFromMaster(lotId, masterItems);

    const projectContext = {
      projectId: lotId,
      activeProjectName: 'Lot 55'
    };

    // --- CASE A: Ambiguous Mutation ("Mark the lights as purchased") ---
    const ambigMutRes = await executeClientToolCall('update_purchasing_item_status', {
      projectId: lotId,
      itemName: 'lights',
      isPurchased: true
    }, projectContext);

    assert.equal(ambigMutRes.success, false, 'Ambiguous mutation must fail');
    assert.equal(ambigMutRes.isAmbiguous, true, 'Ambiguity flag must be set');
    assert.equal(ambigMutRes.matches.length, 5, 'Must find exactly 5 candidate light fixtures');
    assert.match(ambigMutRes.message, /Multiple items match/i);
    assert.match(ambigMutRes.message, /Security lights/i);
    assert.match(ambigMutRes.message, /Vanity lights/i);

    // CRITICAL SAFETY ASSERTION: Zero Firestore writes occurred
    const itemsAfterAmbig = await purchasingService.getItems(lotId);
    const purchasedAfterAmbig = itemsAfterAmbig.filter(it => it.status === 'purchased');
    assert.equal(purchasedAfterAmbig.length, 0, 'SAFETY INVARIANT: Ambiguous mutation must execute ZERO Firestore writes');

    // --- CASE B: Non-Existent Mutation ("Mark the pool heater as purchased") ---
    const notFoundMutRes = await executeClientToolCall('update_purchasing_item_status', {
      projectId: lotId,
      itemName: 'pool heater',
      isPurchased: true
    }, projectContext);

    assert.equal(notFoundMutRes.success, false, 'Nonexistent item mutation must fail');
    assert.equal(notFoundMutRes.isNotFound, true, 'isNotFound flag must be set');
    assert.match(notFoundMutRes.message, /not currently listed/i);
    assert.doesNotMatch(notFoundMutRes.message, /temporarily unavailable/i, 'Must never say temporarily unavailable');

    // CRITICAL SAFETY ASSERTION: Zero Firestore writes occurred
    const itemsAfterNotFound = await purchasingService.getItems(lotId);
    const purchasedAfterNotFound = itemsAfterNotFound.filter(it => it.status === 'purchased');
    assert.equal(purchasedAfterNotFound.length, 0, 'SAFETY INVARIANT: Nonexistent item mutation must execute ZERO Firestore writes');

    // --- CASE C: Exact Mutation ("Mark security lights as purchased") ---
    const exactMutRes = await executeClientToolCall('update_purchasing_item_status', {
      projectId: lotId,
      itemName: 'Security lights',
      isPurchased: true
    }, projectContext);

    assert.equal(exactMutRes.success, true, 'Exact match mutation must succeed');
    assert.equal(exactMutRes.itemName, 'Security lights');

    // Verify exactly ONE item was written to Firestore
    const itemsAfterExact = await purchasingService.getItems(lotId);
    const purchasedAfterExact = itemsAfterExact.filter(it => it.status === 'purchased');
    assert.equal(purchasedAfterExact.length, 1, 'Exactly one item must be marked as purchased');
    assert.equal(purchasedAfterExact[0].itemName, 'Security lights');

    // --- CASE D: Ambiguous Status Query ("Did we buy the lights?") ---
    const broadListRes = await executeClientToolCall('get_purchasing_list', {
      projectId: lotId,
      unpurchasedOnly: false
    }, projectContext);

    const ambigQuerySynth = synthesizeGroundedEvidence(
      [{ name: 'get_purchasing_list', success: true, result: broadListRes }],
      'Did we buy the lights?',
      projectContext
    );

    assert.match(ambigQuerySynth, /5 matching items/i, 'Ambiguous query must identify candidate count');
    assert.match(ambigQuerySynth, /Security lights \(Purchased\)/i, 'Must reflect live purchased status of Security lights');
    assert.match(ambigQuerySynth, /Vanity lights \(Needed\)/i, 'Must reflect live needed status of Vanity lights');
    assert.match(ambigQuerySynth, /Which one were you asking about\?/i, 'Must ask for user clarification');

    // --- CASE E: Exact Status Query ("Did we buy the security lights?") ---
    const exactQuerySynth = synthesizeGroundedEvidence(
      [{ name: 'get_purchasing_list', success: true, result: broadListRes }],
      'Did we buy the security lights?',
      projectContext
    );

    assert.match(exactQuerySynth, /Yes\. The Security lights are marked as purchased on Lot 55\./i, 'Exact query must return direct answer');

    // --- CASE F: Non-Existent Status Query ("Did we buy the pool heater?") ---
    const notFoundQuerySynth = synthesizeGroundedEvidence(
      [{ name: 'get_purchasing_list', success: true, result: broadListRes }],
      'Did we buy the pool heater?',
      projectContext
    );

    assert.match(notFoundQuerySynth, /(That item|"pool heater") is not currently listed on the Lot 55 purchasing checklist\./i, 'Nonexistent item query must report not listed');
  });

  test('11. Full End-to-End Conversational Pipeline: Deterministic Routing Guard, Disambiguation & Safe Item Addition', async () => {
    const lotId = 'lot_55_e2e_pipeline';
    const projectContext = {
      activeProjectId: lotId,
      activeProjectName: 'Lot 55',
      jobsiteId: 'site_55'
    };

    // Initial 20-item checklist (includes 5 light fixtures)
    const masterItems = [
      { id: 'item_quartz_1', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Electrical pass-through caps', status: 'needed', quantity: 1 },
      { id: 'item_quartz_2', categoryId: 'quartz', categoryTitle: 'Quartz Hardware', itemName: 'Sinks', status: 'needed', quantity: 1 },
      { id: 'item_elec_1', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Security lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_4', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Front porch hanging light', status: 'needed', quantity: 1 },
      { id: 'item_elec_5', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Exterior column lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_6', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Garage ceiling lights with the cap to install it', status: 'needed', quantity: 1 },
      { id: 'item_elec_7', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Vanity lights', status: 'needed', quantity: 1 },
      { id: 'item_elec_2', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Contractor doorbell chime kit', status: 'needed', quantity: 1 },
      { id: 'item_elec_3', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart doorbell', status: 'needed', quantity: 1 },
      { id: 'item_elec_8', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Smart switches', status: 'needed', quantity: 8 },
      { id: 'item_elec_9', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Extension rods', status: 'needed', quantity: 1 },
      { id: 'item_elec_10', categoryId: 'electrical', categoryTitle: 'Electrical Hardware Fixtures', itemName: 'Ceiling fans', status: 'needed', quantity: 1 },
      { id: 'item_plumb_1', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Soap dispenser', status: 'needed', quantity: 1 },
      { id: 'item_plumb_2', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal power button', status: 'needed', quantity: 1 },
      { id: 'item_plumb_3', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Garbage disposal', status: 'needed', quantity: 1 },
      { id: 'item_plumb_4', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Water heater with the water heater stand and tray', status: 'needed', quantity: 1 },
      { id: 'item_plumb_5', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Shower pan liner', status: 'needed', quantity: 1 },
      { id: 'item_plumb_6', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Bathroom vanity faucets', status: 'needed', quantity: 2 },
      { id: 'item_plumb_7', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Kitchen faucets', status: 'needed', quantity: 1 },
      { id: 'item_plumb_8', categoryId: 'plumbing', categoryTitle: 'Plumbing Hardware Fixtures', itemName: 'Toilet supply lines', status: 'needed', quantity: 3 }
    ];

    await purchasingService.storage.saveItems(lotId, masterItems);
    const initialItems = await purchasingService.getItems(lotId);
    assert.equal(initialItems.length, 20, 'Must start with 20 items');

    // -------------------------------------------------------------
    // Scenario 1: Exact Mutation ("Mark security lights as purchased")
    // -------------------------------------------------------------
    const q1 = 'Mark security lights as purchased';
    assert.equal(isPurchaseStatusMutationCommand(q1), true);
    assert.equal(extractPurchasingSubjectFromQuery(q1), 'security lights');

    const rawCalls1 = [{ name: 'update_purchasing_item_status', args: { itemName: 'security lights', projectId: lotId } }];
    const normCalls1 = normalizePurchasingToolCalls(rawCalls1, q1);
    const res1 = await executeClientToolCall(normCalls1[0].name, normCalls1[0].args, { ...projectContext, userQuery: q1 });
    assert.equal(res1.success, true);
    assert.equal(res1.itemName, 'Security lights');

    const itemsAfter1 = await purchasingService.getItems(lotId);
    assert.equal(itemsAfter1.filter(it => it.status === 'purchased').length, 1, 'Exactly 1 item purchased');

    // -------------------------------------------------------------
    // Scenario 2: Ambiguous Mutation with Multi-Call Hallucination ("Mark the lights as purchased")
    // Model proposed TWO parallel calls for specific lights!
    // -------------------------------------------------------------
    const q2 = 'Mark the lights as purchased';
    assert.equal(isPurchaseStatusMutationCommand(q2), true);
    assert.equal(extractPurchasingSubjectFromQuery(q2), 'lights');

    // Model hallucinated calling two separate items in parallel
    const rawCalls2 = [
      { name: 'update_purchasing_item_status', args: { itemName: 'Exterior column lights', isPurchased: true, projectId: lotId } },
      { name: 'update_purchasing_item_status', args: { itemName: 'Garage ceiling lights with the cap to install it', isPurchased: true, projectId: lotId } }
    ];
    const normCalls2 = normalizePurchasingToolCalls(rawCalls2, q2);
    assert.equal(normCalls2.length, 1, 'Multi-call hallucination must collapse to exactly 1 authoritative call');
    assert.equal(normCalls2[0].name, 'update_purchasing_item_status');
    assert.equal(normCalls2[0].args.itemName, 'lights', 'Target item must be the user query subject, not model hallucinations');

    const res2 = await executeClientToolCall(normCalls2[0].name, normCalls2[0].args, { ...projectContext, userQuery: q2 });
    assert.equal(res2.success, false, 'Must not mutate ambiguous item');
    assert.equal(res2.isAmbiguous, true);
    assert.equal(res2.matches.length, 5, 'Must return 5 light fixtures');

    const itemsAfter2 = await purchasingService.getItems(lotId);
    assert.equal(itemsAfter2.filter(it => it.status === 'purchased').length, 1, 'Zero writes allowed on ambiguous mutation (count remains 1)');

    // -------------------------------------------------------------
    // Scenario 3: Nonexistent Mutation ("Mark the pool heater as purchased")
    // Model hallucinated calling add_purchasing_item!
    // -------------------------------------------------------------
    const q3 = 'Mark the pool heater as purchased';
    assert.equal(isPurchaseStatusMutationCommand(q3), true);
    assert.equal(extractPurchasingSubjectFromQuery(q3), 'pool heater');

    // Model hallucinated add_purchasing_item
    const rawCalls3 = [{ name: 'add_purchasing_item', args: { item: 'pool heater', projectId: lotId } }];
    const normCalls3 = normalizePurchasingToolCalls(rawCalls3, q3);
    assert.equal(normCalls3[0].name, 'update_purchasing_item_status', 'Must be deterministically converted from add to update');

    const res3 = await executeClientToolCall(normCalls3[0].name, normCalls3[0].args, { ...projectContext, userQuery: q3 });
    assert.equal(res3.success, false, 'Must fail safely for nonexistent item');
    assert.equal(res3.isNotFound, true);
    assert.match(res3.message, /not currently listed/i, 'Must report item is not on checklist');

    const itemsAfter3 = await purchasingService.getItems(lotId);
    assert.equal(itemsAfter3.length, 20, 'Zero writes allowed for nonexistent item: count remains 20');
    assert.equal(itemsAfter3.some(it => it.itemName.toLowerCase().includes('pool heater')), false, 'Pool heater must NOT be created');

    // -------------------------------------------------------------
    // Scenario 4: Ambiguous Status Query ("Did we buy the lights?")
    // -------------------------------------------------------------
    const q4 = 'Did we buy the lights?';
    assert.equal(isPurchaseStatusMutationCommand(q4), false);

    const listRes4 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q4 });
    assert.ok(listRes4.itemLookup, 'itemLookup must be embedded in get_purchasing_list result');
    assert.equal(listRes4.itemLookup.matchType, 'AMBIGUOUS');
    assert.equal(listRes4.itemLookup.matchCount, 5);

    // Validate second-pass grounding check
    const grounding4 = verifyResponseGrounding(
      'That item is not currently listed on the Lot 55 purchasing checklist.',
      projectContext,
      [{ name: 'get_purchasing_list', success: true, result: listRes4, data: listRes4 }]
    );
    assert.equal(grounding4.status, 'unsupported_claims_detected', 'Must catch hallucinated not-listed claim for ambiguous item');
    assert.match(grounding4.suggestedCorrection, /5 matching items/i, 'Correction must provide candidate disambiguation');

    // -------------------------------------------------------------
    // Scenario 5: Exact Status Query ("Did we buy the security lights?")
    // -------------------------------------------------------------
    const q5 = 'Did we buy the security lights?';
    const listRes5 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q5 });
    assert.ok(listRes5.itemLookup);
    assert.equal(listRes5.itemLookup.matchType, 'EXACT');
    assert.match(listRes5.itemLookup.canonicalAnswer, /Yes\. The Security lights are marked as purchased on Lot 55\./i);

    // -------------------------------------------------------------
    // Scenario 6: Explicit Item Creation ("Add a pool heater to electrical")
    // -------------------------------------------------------------
    const q6 = 'Add a pool heater to electrical';
    assert.equal(isPurchaseStatusMutationCommand(q6), false, 'Explicit add command must NOT be intercepted as status mutation');

    const rawCalls6 = [{ name: 'add_purchasing_item', args: { item: 'pool heater', category: 'electrical', projectId: lotId } }];
    const normCalls6 = normalizePurchasingToolCalls(rawCalls6, q6);
    assert.equal(normCalls6[0].name, 'add_purchasing_item', 'Explicit creation must remain add_purchasing_item');

    const res6 = await executeClientToolCall(normCalls6[0].name, normCalls6[0].args, { ...projectContext, userQuery: q6 });
    assert.equal(res6.success, true, 'Explicit creation must succeed');

    const itemsAfter6 = await purchasingService.getItems(lotId);
    assert.equal(itemsAfter6.length, 21, 'Checklist count increases from 20 to 21 (1 write)');
    assert.ok(itemsAfter6.some(it => it.itemName.toLowerCase() === 'pool heater'));

    // -------------------------------------------------------------
    // Scenario 7: Broad Purchased Query ("what have we already purchased")
    // Must be strictly READ-ONLY and list the 1 purchased item
    // -------------------------------------------------------------
    const q7 = 'what have we already purchased';
    assert.equal(isPurchaseStatusMutationCommand(q7), false, '"what have we already purchased" must be READ-ONLY');

    const listRes7 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q7 });
    assert.equal(listRes7.success, true);
    assert.equal(listRes7.itemLookup, null, 'Broad query must not generate specific itemLookup');
    assert.equal(listRes7.summary.purchasedCount, 1, 'Reflects 1 purchased item');

    // -------------------------------------------------------------
    // Scenario 8: Demonstrative Ambiguous Query ("have we bought those lights yet")
    // Must be READ-ONLY, strip "those" and "yet", and return 5 light candidates
    // -------------------------------------------------------------
    const q8 = 'have we bought those lights yet';
    assert.equal(isPurchaseStatusMutationCommand(q8), false, '"have we bought those lights yet" must be READ-ONLY');

    const listRes8 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q8 });
    assert.ok(listRes8.itemLookup);
    assert.equal(listRes8.itemLookup.matchType, 'AMBIGUOUS');
    assert.equal(listRes8.itemLookup.matchCount, 5);
    assert.match(listRes8.itemLookup.canonicalAnswer, /5 matching items/i);

    // -------------------------------------------------------------
    // Scenario 9: Demonstrative Exact Query ("did we buy those ceiling fans already")
    // Must be READ-ONLY, strip "those" and "already", and match Ceiling fans
    // -------------------------------------------------------------
    const q9 = 'did we buy those ceiling fans already';
    assert.equal(isPurchaseStatusMutationCommand(q9), false, '"did we buy those ceiling fans already" must be READ-ONLY');

    const listRes9 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q9 });
    assert.ok(listRes9.itemLookup);
    assert.equal(listRes9.itemLookup.matchType, 'EXACT');
    assert.match(listRes9.itemLookup.canonicalAnswer, /Ceiling fans are still marked as needed/i);

    // -------------------------------------------------------------
    // Scenario 10: Demonstrative Mutation ("check off that vanity light")
    // Must be WRITE command, strip "that", and update Vanity lights
    // -------------------------------------------------------------
    const q10 = 'check off that vanity light';
    assert.equal(isPurchaseStatusMutationCommand(q10), true, '"check off that vanity light" must be a mutation');
    assert.equal(extractPurchasingSubjectFromQuery(q10), 'vanity light');

    const rawCalls10 = [{ name: 'get_purchasing_list', args: { projectId: lotId } }];
    const normCalls10 = normalizePurchasingToolCalls(rawCalls10, q10);
    assert.equal(normCalls10[0].name, 'update_purchasing_item_status');

    const res10 = await executeClientToolCall(normCalls10[0].name, normCalls10[0].args, { ...projectContext, userQuery: q10 });
    assert.equal(res10.success, true);
    assert.equal(res10.itemName, 'Vanity lights');

    const itemsAfter10 = await purchasingService.getItems(lotId);
    assert.equal(itemsAfter10.filter(it => it.status === 'purchased').length, 2, '2 items now purchased (Security lights + Vanity lights)');

    // -------------------------------------------------------------
    // Scenario 11: Quantity/Existence Inquiry ("How many pool heaters do we have on the purchasing list?")
    // Must return exact item quantity and status, NOT broad summary
    // -------------------------------------------------------------
    const q11 = 'How many pool heaters do we have on the purchasing list?';
    assert.equal(isPurchaseStatusMutationCommand(q11), false, 'Quantity query must be READ-ONLY');

    const listRes11 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q11 });
    assert.ok(listRes11.itemLookup, 'itemLookup must be populated for quantity query');
    assert.ok(['EXACT', 'SINGLE_MATCH'].includes(listRes11.itemLookup.matchType));
    assert.match(listRes11.itemLookup.canonicalAnswer, /You have 1 Pool heater \(Needed\) on the Lot 55 purchasing checklist\./i);

    // -------------------------------------------------------------
    // Scenario 12: Trade-Specific List ("Show me the Electrical Hardware Fixtures list")
    // Must return individual items belonging to that trade section
    // -------------------------------------------------------------
    const q12 = 'Show me the Electrical Hardware Fixtures list';
    assert.equal(isPurchaseStatusMutationCommand(q12), false);

    const listRes12 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, trade: 'electrical', unpurchasedOnly: false }, { ...projectContext, userQuery: q12 });
    assert.match(listRes12.summary.canonicalAnswer, /Electrical Hardware Fixtures for Lot 55/i);
    assert.match(listRes12.summary.canonicalAnswer, /•/i, 'Must contain bullet list of individual items');

    // -------------------------------------------------------------
    // Scenario 13: Idempotent Add ("Add a pool heater to the purchasing list" called twice)
    // Second identical call must report already exists with ZERO writes (quantity remains 1)
    // -------------------------------------------------------------
    const q13 = 'Add a pool heater to the purchasing list';
    const res13 = await executeClientToolCall('add_purchasing_item', { item: 'pool heater', projectId: lotId }, { ...projectContext, userQuery: q13 });
    assert.equal(res13.action, 'ALREADY_EXISTS');
    assert.equal(res13.isDuplicate, true);
    assert.equal(res13.status, 'already_exists');
    assert.match(res13.message, /already on the.*purchasing checklist/i);

    const itemsAfter13 = await purchasingService.getItems(lotId);
    const poolHeater13 = itemsAfter13.find(it => it.itemName.toLowerCase() === 'pool heater');
    assert.equal(poolHeater13?.quantity, 1, 'Quantity must remain 1 on identical repeat add (0 writes)');

    // -------------------------------------------------------------
    // Scenario 14: Explicit Increment ("Add 2 more pool heaters to the purchasing list")
    // Explicit increment language increases quantity by 2 (quantity becomes 3, 1 write)
    // -------------------------------------------------------------
    const q14 = 'Add 2 more pool heaters to the purchasing list';
    const res14 = await executeClientToolCall('add_purchasing_item', { item: '2 more pool heaters', projectId: lotId }, { ...projectContext, userQuery: q14 });
    assert.equal(res14.action, 'UPDATE_QUANTITY');
    assert.equal(res14.quantity, 3, 'Quantity increments from 1 to 3 on explicit increment');

    const itemsAfter14 = await purchasingService.getItems(lotId);
    const poolHeater14 = itemsAfter14.find(it => it.itemName.toLowerCase() === 'pool heater');
    assert.equal(poolHeater14?.quantity, 3, 'Persisted quantity must be 3');

    // -------------------------------------------------------------
    // Scenario 15: Read Query with Model Hallucinated Mutation Tool
    // Model proposed update_purchasing_item_status for "What do we need for electrical?"
    // Deterministic layer must convert it to get_purchasing_list (0 writes)
    // -------------------------------------------------------------
    const q15 = 'What do we need for electrical?';
    assert.equal(isPurchaseStatusMutationCommand(q15), false);
    const rawCalls15 = [{ name: 'update_purchasing_item_status', args: { itemName: 'electrical', projectId: lotId } }];
    const normCalls15 = normalizePurchasingToolCalls(rawCalls15, q15);
    assert.equal(normCalls15[0].name, 'get_purchasing_list', 'Read query must be forced to get_purchasing_list even if model proposed mutation');

    // -------------------------------------------------------------
    // Scenario 16: Answer-Priority Hierarchy Grounding Tests
    // itemLookup > trade filter > project-wide summary
    // -------------------------------------------------------------
    const { formatToolResultsForSynthesis } = await import('../src/services/builderBrainService.js');
    const synthTextItem = formatToolResultsForSynthesis([{ name: 'get_purchasing_list', success: true, result: listRes11, data: listRes11 }]);
    assert.match(synthTextItem, /PRIORITY TARGET ITEM QUERY RESOLUTION/i);

    const synthTextTrade = formatToolResultsForSynthesis([{ name: 'get_purchasing_list', success: true, result: listRes12, data: listRes12 }]);
    assert.match(synthTextTrade, /PRIORITY TRADE ITEM LIST/i);

    const synthTextDup = formatToolResultsForSynthesis([{ name: 'add_purchasing_item', success: true, result: res13, data: res13, isDuplicate: true }]);
    assert.match(synthTextDup, /STATUS: ALREADY_EXISTS/i);
    assert.match(synthTextDup, /Deduplicated idempotent 0-write/i);

    // -------------------------------------------------------------
    // Scenario 17: Broad Purchased-Items Inquiry ("What have we already purchased for this lot?")
    // When multiple items are purchased (e.g. Security lights, Ceiling fans, Sinks, Bathroom vanity faucets, Kitchen faucets, Soap dispenser = 6 items),
    // must return actual purchased item names, 0 writes, and no contradictory category totals.
    // -------------------------------------------------------------
    await purchasingService.updateItemStatus(lotId, 'Ceiling fans', 'purchased');
    await purchasingService.updateItemStatus(lotId, 'Sinks', 'purchased');
    await purchasingService.updateItemStatus(lotId, 'Bathroom vanity faucets', 'purchased');
    await purchasingService.updateItemStatus(lotId, 'Kitchen faucets', 'purchased');
    await purchasingService.updateItemStatus(lotId, 'Soap dispenser', 'purchased');

    const q17 = 'What have we already purchased for this lot?';
    assert.equal(isPurchaseStatusMutationCommand(q17), false, 'Purchased query must be READ-only');

    const listRes17 = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q17 });
    assert.equal(listRes17.totalPurchased, 7);
    assert.match(listRes17.summary.canonicalAnswer, /Purchased items for Lot 55 \(7 items\):/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Security lights/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Vanity lights/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Ceiling fans/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Sinks/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Bathroom vanity faucets/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Kitchen faucets/i);
    assert.match(listRes17.summary.canonicalAnswer, /• Soap dispenser/i);
    assert.doesNotMatch(listRes17.summary.canonicalAnswer, /still have \d+ items to purchase/i, 'Must not override with unpurchased summary');
    assert.doesNotMatch(listRes17.summary.canonicalAnswer, /\b15\b/, 'No contradictory 15 total in purchased list');

    const synth17 = synthesizeGroundedEvidence([{ name: 'get_purchasing_list', success: true, result: listRes17 }], q17, projectContext);
    assert.match(synth17, /Purchased items for Lot 55/i);
    assert.match(synth17, /Security lights/i);
    assert.match(synth17, /Ceiling fans/i);
    assert.match(synth17, /Sinks/i);

    // Reset the temporary 5 purchased items back to needed before post-test reset
    await purchasingService.updateItemStatus(lotId, 'Ceiling fans', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Sinks', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Bathroom vanity faucets', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Kitchen faucets', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Soap dispenser', 'needed');

    // -------------------------------------------------------------
    // Scenario 18: Generalized Trade-Scoped Status Inquiries
    // Must NOT look up trade phrases as item names; must return filtered trade lists
    // -------------------------------------------------------------
    await purchasingService.updateItemStatus(lotId, 'Bathroom vanity faucets', 'purchased');
    await purchasingService.updateItemStatus(lotId, 'Kitchen faucets', 'purchased');

    // 18a: "What Plumbing items have we purchased"
    const q18a = 'What Plumbing items have we purchased';
    assert.equal(isPurchaseStatusMutationCommand(q18a), false, 'Trade query must be READ-only');
    const res18a = await executeClientToolCall('get_purchasing_list', { projectId: lotId, trade: 'plumbing', unpurchasedOnly: false }, { ...projectContext, userQuery: q18a });
    assert.equal(res18a.itemLookup, null, 'Must NOT create itemLookup for trade-scoped question');
    assert.match(res18a.summary.canonicalAnswer, /Purchased Plumbing Hardware Fixtures for Lot 55 \(2 items\):/i);
    assert.match(res18a.summary.canonicalAnswer, /• Bathroom vanity faucets/i);
    assert.match(res18a.summary.canonicalAnswer, /• Kitchen faucets/i);
    assert.doesNotMatch(res18a.summary.canonicalAnswer, /not currently listed/i);

    // 18b: "Which plumbing items do we still need?"
    const q18b = 'Which plumbing items do we still need?';
    assert.equal(isPurchaseStatusMutationCommand(q18b), false);
    const res18b = await executeClientToolCall('get_purchasing_list', { projectId: lotId, trade: 'plumbing' }, { ...projectContext, userQuery: q18b });
    assert.equal(res18b.itemLookup, null);
    assert.match(res18b.summary.canonicalAnswer, /Plumbing Hardware Fixtures needed for Lot 55 \(6 items\):/i);
    assert.match(res18b.summary.canonicalAnswer, /• Soap dispenser/i);
    assert.match(res18b.summary.canonicalAnswer, /• Garbage disposal/i);

    // 18c: "What electrical stuff have we purchased?" (Security lights + Vanity lights are purchased)
    const q18c = 'What electrical stuff have we purchased?';
    assert.equal(isPurchaseStatusMutationCommand(q18c), false);
    const res18c = await executeClientToolCall('get_purchasing_list', { projectId: lotId, trade: 'electrical', unpurchasedOnly: false }, { ...projectContext, userQuery: q18c });
    assert.equal(res18c.itemLookup, null);
    assert.match(res18c.summary.canonicalAnswer, /Purchased Electrical Hardware Fixtures for Lot 55 \(2 items\):/i);
    assert.match(res18c.summary.canonicalAnswer, /• Security lights/i);
    assert.match(res18c.summary.canonicalAnswer, /• Vanity lights/i);

    // 18d: "What electrical items do we still need" (9 items needed in electrical)
    const q18d = 'What electrical items do we still need';
    assert.equal(isPurchaseStatusMutationCommand(q18d), false);
    const res18d = await executeClientToolCall('get_purchasing_list', { projectId: lotId, trade: 'electrical' }, { ...projectContext, userQuery: q18d });
    assert.equal(res18d.itemLookup, null);
    assert.match(res18d.summary.canonicalAnswer, /Electrical Hardware Fixtures needed for Lot 55 \(9 items\):/i);
    assert.match(res18d.summary.canonicalAnswer, /• Ceiling fans/i);
    assert.match(res18d.summary.canonicalAnswer, /• Front porch hanging light/i);

    // Reset faucets before baseline reset
    await purchasingService.updateItemStatus(lotId, 'Bathroom vanity faucets', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Kitchen faucets', 'needed');

    // -------------------------------------------------------------
    // Scenario 19: Trade-Context Item Disambiguation & Trade Normalization
    // -------------------------------------------------------------
    // 19a: "Did we buy the pool heater in general Hardware"
    // Item subject: "pool heater", trade context: "in general Hardware", singular grammar + quantity
    const q19a = 'Did we buy the pool heater in general Hardware';
    assert.equal(isPurchaseStatusMutationCommand(q19a), false);

    const rawCalls19a = [{ name: 'get_purchasing_list', args: { projectId: lotId, trade: 'general Hardware', unpurchasedOnly: false } }];
    const normCalls19a = normalizePurchasingToolCalls(rawCalls19a, q19a);
    assert.equal(normCalls19a[0].args.trade, 'general', 'general Hardware normalizes to general');

    const res19a = await executeClientToolCall('get_purchasing_list', normCalls19a[0].args, { ...projectContext, userQuery: q19a });
    assert.notEqual(res19a.itemLookup, null, 'Must extract pool heater itemLookup even with trade context');
    assert.equal(res19a.itemLookup.subject, 'pool heater');
    assert.match(res19a.itemLookup.canonicalAnswer, /No\. The pool heater is still marked as needed on Lot 55\. Quantity: 3\./i);

    // 19b: "How many pool heaters do we have" with hallucinated trade: "pool"
    const q19b = 'How many pool heaters do we have';
    assert.equal(isPurchaseStatusMutationCommand(q19b), false);

    const rawCalls19b = [{ name: 'get_purchasing_list', args: { projectId: lotId, trade: 'pool', unpurchasedOnly: false } }];
    const normCalls19b = normalizePurchasingToolCalls(rawCalls19b, q19b);
    assert.equal(normCalls19b[0].args.trade, undefined, 'Invalid trade "pool" must be purged from trade filter');
    assert.equal(normCalls19b[0].args.itemName, 'pool', 'Moved invalid trade to itemName');

    // -------------------------------------------------------------
    // Scenario 20: Trade-Scoped Collection Count Inquiries vs Single-Item Quantity
    // -------------------------------------------------------------
    // Mark 5 more electrical items as purchased so electrical has 7 purchased items
    const allElecItems20 = (await purchasingService.getItems(lotId)).filter(i => (i.categoryId || 'general') === 'electrical');
    for (let i = 0; i < 7; i++) {
      await purchasingService.updateItemStatus(lotId, allElecItems20[i].itemName, 'purchased');
    }

    // 20a: "How many electrical items have we purchased?" (Collection count: 7 purchased)
    const q20a = 'How many electrical items have we purchased?';
    assert.equal(isPurchaseStatusMutationCommand(q20a), false);
    const res20a = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20a });
    assert.equal(res20a.itemLookup, null, 'Must NOT create itemLookup for trade collection count');
    assert.match(res20a.summary.canonicalAnswer, /You have purchased 7 Electrical Hardware Fixtures items for Lot 55/i);
    assert.doesNotMatch(res20a.summary.canonicalAnswer, /not currently (listed|on)/i);

    // 20b: "How many plumbing items have we purchased?" (0 plumbing purchased)
    const q20b = 'How many plumbing items have we purchased?';
    assert.equal(isPurchaseStatusMutationCommand(q20b), false);
    const res20b = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20b });
    assert.equal(res20b.itemLookup, null);
    assert.match(res20b.summary.canonicalAnswer, /No plumbing hardware fixtures have been marked as purchased yet for Lot 55/i);

    // 20c: "How many electrical items do we still need?"
    const q20c = 'How many electrical items do we still need?';
    assert.equal(isPurchaseStatusMutationCommand(q20c), false);
    const res20c = await executeClientToolCall('get_purchasing_list', { projectId: lotId }, { ...projectContext, userQuery: q20c });
    assert.equal(res20c.itemLookup, null);
    assert.match(res20c.summary.canonicalAnswer, /You still need to purchase \d+ Electrical Hardware Fixtures items for Lot 55/i);

    // 20d: "How many plumbing fixtures do we still need?" (8 plumbing needed)
    const q20d = 'How many plumbing fixtures do we still need?';
    assert.equal(isPurchaseStatusMutationCommand(q20d), false);
    const res20d = await executeClientToolCall('get_purchasing_list', { projectId: lotId }, { ...projectContext, userQuery: q20d });
    assert.equal(res20d.itemLookup, null);
    assert.match(res20d.summary.canonicalAnswer, /You still need to purchase 8 Plumbing Hardware Fixtures items for Lot 55/i);

    // 20e: "How many items have we purchased in electrical?"
    const q20e = 'How many items have we purchased in electrical?';
    assert.equal(isPurchaseStatusMutationCommand(q20e), false);
    const res20e = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20e });
    assert.equal(res20e.itemLookup, null);
    assert.match(res20e.summary.canonicalAnswer, /You have purchased 7 Electrical Hardware Fixtures items for Lot 55/i);

    // 20f: "How many purchased electrical items do we have?"
    const q20f = 'How many purchased electrical items do we have?';
    assert.equal(isPurchaseStatusMutationCommand(q20f), false);
    const res20f = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20f });
    assert.equal(res20f.itemLookup, null);
    assert.match(res20f.summary.canonicalAnswer, /You have purchased 7 Electrical Hardware Fixtures items for Lot 55/i);

    // 20g: "How many pool heaters do we have?" (Single-item quantity: Qty 3)
    const q20g = 'How many pool heaters do we have?';
    assert.equal(isPurchaseStatusMutationCommand(q20g), false);
    const res20g = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20g });
    assert.notEqual(res20g.itemLookup, null, 'Must create itemLookup for specific item quantity');
    assert.match(res20g.itemLookup.canonicalAnswer, /You have 3 Pool heater \(Needed\) on the Lot 55 purchasing checklist\./i);

    // 20h: "How many ceiling fans do we have?" (Single-item quantity: Qty 1)
    const q20h = 'How many ceiling fans do we have?';
    assert.equal(isPurchaseStatusMutationCommand(q20h), false);
    const res20h = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, { ...projectContext, userQuery: q20h });
    assert.notEqual(res20h.itemLookup, null, 'Must create itemLookup for specific item quantity');
    assert.match(res20h.itemLookup.canonicalAnswer, /You have 1 Ceiling fans \((Purchased|Needed)\) on the Lot 55 purchasing checklist\./i);

    // Reset electrical items back to needed before baseline reset
    for (let i = 0; i < 7; i++) {
      await purchasingService.updateItemStatus(lotId, allElecItems20[i].itemName, 'needed');
    }
    // -------------------------------------------------------------
    // Scenario 21: Idempotent Status Updates (0 writes on already-purchased item)
    // "Mark the contractors doorbell chime kit as purchased" executed twice
    // -------------------------------------------------------------
    const q21 = 'Mark the contractors doorbell chime kit as purchased';
    assert.equal(isPurchaseStatusMutationCommand(q21), true);

    // 1st Execution: Updates from needed -> purchased (1 write)
    const res21_1 = await purchasingService.updateItemStatus(lotId, 'Contractor doorbell chime kit', 'purchased');
    assert.equal(res21_1.success, true);
    assert.equal(res21_1.action, 'UPDATE_STATUS');
    assert.equal(res21_1.writesPerformed, 1);
    assert.match(res21_1.message, /Marked Contractor doorbell chime kit as purchased/i);

    // 2nd Execution: Item already purchased -> NO_OP (0 writes)
    const res21_2 = await purchasingService.updateItemStatus(lotId, 'Contractor doorbell chime kit', 'purchased');
    assert.equal(res21_2.success, true);
    assert.equal(res21_2.action, 'NO_OP');
    assert.equal(res21_2.status, 'ALREADY_PURCHASED');
    assert.equal(res21_2.isAlreadyInState, true);
    assert.equal(res21_2.writesPerformed, 0, 'Must perform exactly 0 writes when already in state');
    assert.match(res21_2.message, /already marked as purchased/i);

    // Reset doorbell chime kit back to needed before post-test reset
    await purchasingService.updateItemStatus(lotId, 'Contractor doorbell chime kit', 'needed');
    await purchasingService.updateItemStatus(lotId, 'Security lights', 'purchased');

    // -------------------------------------------------------------
    // Scenario 22: Comparison Overview Inquiry (Purchased vs Needed)
    // "What have we purchased versus what do we still need to purchase for Lot 55?"
    // -------------------------------------------------------------
    const q22 = 'What have we purchased versus what do we still need to purchase for Lot 55?';
    assert.equal(isPurchaseStatusMutationCommand(q22), false, 'Comparison inquiry must be strictly READ-only');

    const compContext = { ...projectContext, userQuery: q22 };
    const compRes = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, compContext);

    assert.equal(compRes.success, true);
    assert.match(compRes.summary.canonicalAnswer, /Lot 55 Purchasing Status:/i);
    assert.match(compRes.summary.canonicalAnswer, /Purchased:\s+\d+\s+item/i);
    assert.match(compRes.summary.canonicalAnswer, /Still needed:\s+\d+\s+item/i);
    assert.match(compRes.summary.canonicalAnswer, /Total:\s+\d+\s+item/i);
    assert.match(compRes.summary.canonicalAnswer, /Purchased:\n/i);
    assert.match(compRes.summary.canonicalAnswer, /Still needed:\n/i);
    assert.match(compRes.summary.canonicalAnswer, /I can give you the detailed item list for any trade/i);

    const compSynthesis = formatToolResultsHumanReadable(
      [{ name: 'get_purchasing_list', success: true, result: compRes, toolType: 'READ' }],
      q22,
      compContext
    );
    assert.match(compSynthesis, /Lot 55 Purchasing Status:/i);
    assert.match(compSynthesis, /Purchased:/i);
    assert.match(compSynthesis, /Still needed:/i);

    // -------------------------------------------------------------
    // Post-Test Clean Baseline Reset:
    // 1. Remove pool heater
    // 2. Reset Vanity lights to needed
    // 3. Assert exact baseline: 20 total, 19 needed, 1 purchased (Security lights)
    // -------------------------------------------------------------
    await purchasingService.removeItem(lotId, 'pool heater');
    await purchasingService.updateItemStatus(lotId, 'vanity lights', 'needed');

    const finalCleanItems = await purchasingService.getItems(lotId);
    assert.equal(finalCleanItems.length, 20, 'Lot 55 baseline must have exactly 20 items');
    assert.equal(finalCleanItems.some(it => it.itemName.toLowerCase().includes('pool heater')), false, 'Pool heater must be gone');
    assert.equal(finalCleanItems.filter(it => it.status === 'purchased').length, 1, 'Exactly 1 item purchased (Security lights)');
    assert.equal(finalCleanItems.filter(it => it.status === 'needed').length, 19, 'Exactly 19 items needed');

    const securityLight = finalCleanItems.find(it => it.itemName === 'Security lights');
    assert.equal(securityLight?.status, 'purchased', 'Security lights is the only purchased item');

    const vanityLight = finalCleanItems.find(it => it.itemName === 'Vanity lights');
    assert.equal(vanityLight?.status, 'needed', 'Vanity lights reset to needed');

    const cleanListRes = await executeClientToolCall('get_purchasing_list', { projectId: lotId, unpurchasedOnly: false }, projectContext);
    assert.equal(cleanListRes.summary.totalChecklistCount, 20);
    assert.equal(cleanListRes.summary.neededCount, 19);
    assert.equal(cleanListRes.summary.purchasedCount, 1);
  });
});