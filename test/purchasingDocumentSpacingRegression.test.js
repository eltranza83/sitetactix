import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePurchasingDocumentSpacing,
  syncMasterPurchasingToProjects,
  calculateSectionInsertion,
  parseGoogleDocPurchasingStructure,
  LocalStoragePurchasingAdapter,
  saveProjectPurchasingDoc,
  saveMasterPurchasingDoc,
  getDefaultProjectDoc
} from '../src/services/googleDocsPurchasingService.js';
import {
  writeDocumentContent,
  setCustomContentProvider,
  resetContentProvider,
  DOCUMENT_STATES
} from '../src/services/documentContentProvider.js';

class MockMemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const CLEAN_MASTER_TEMPLATE = `# Master Fixtures & Hardware Purchasing Checklist (Company Master Template — v1.0)
<!-- version: 1.0 -->

<!-- section: quartz -->
## 1. Quartz Hardware
- [ ] Electrical pass-through caps
- [ ] Sinks

<!-- section: electrical -->
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

<!-- section: plumbing -->
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

test('Scenario 1: Repeated Sync Idempotency (Clean Doc -> Sync 1 -> Sync 2 -> Sync 10)', () => {
  const storage = new MockMemoryStorage();
  const adapter = new LocalStoragePurchasingAdapter(storage);

  adapter.saveMasterDocument(CLEAN_MASTER_TEMPLATE);
  adapter.saveProjectDocument('lot_3', getDefaultProjectDoc('lot_3', 'v1.0'));

  const res1 = syncMasterPurchasingToProjects(adapter, ['lot_3']);
  const docAfterSync1 = adapter.getProjectDocument('lot_3');

  assert.equal(res1.projectsSynced.length, 1);
  assert.ok(docAfterSync1.includes('Electrical pass-through caps'));
  assert.ok(docAfterSync1.includes('Security lights'));
  assert.ok(docAfterSync1.includes('Soap dispenser'));

  const tripleNewlinesCount1 = (docAfterSync1.match(/\n\n\n/g) || []).length;
  assert.equal(tripleNewlinesCount1, 0, 'Must have ZERO triple newlines after sync 1');

  for (let i = 2; i <= 10; i++) {
    syncMasterPurchasingToProjects(adapter, ['lot_3']);
    const docAfterSyncN = adapter.getProjectDocument('lot_3');
    assert.equal(docAfterSyncN, docAfterSync1, 'Sync #' + i + ' must produce byte-identical content with 0 whitespace drift');
    assert.equal((docAfterSyncN.match(/\n\n\n/g) || []).length, 0, 'Sync #' + i + ' must not create triple newlines');
  }
});

test('Scenario 2: Progressive \\n\\n -> \\n\\n\\n\\n Expansion Guard', () => {
  let doc = `# Master Fixtures & Hardware Purchasing Checklist - Project lot_3 (Template: v1.0)

<!-- section: quartz -->
## 1. Quartz Hardware
- [ ] Sinks

<!-- section: electrical -->
## 2. Electrical Hardware Fixtures
- [ ] Vanity lights
`;

  const initialLength = doc.length;
  for (let i = 0; i < 20; i++) {
    doc = normalizePurchasingDocumentSpacing(doc);
    assert.equal(doc.length, initialLength, 'Iteration ' + (i + 1) + ' must preserve character length');
    assert.equal(doc.includes('\n\n\n'), false, 'Must not contain 3+ consecutive newlines');
  }

  const sections = doc.split('<!-- section:');
  assert.equal(sections.length, 3);
  assert.ok(doc.includes('## 1. Quartz Hardware\n- [ ] Sinks\n\n<!-- section: electrical -->'));
});

test('Scenario 3: Sequential Mutation Flow (Sync -> Add Item -> Sync -> Add Section -> Sync)', () => {
  const storage = new MockMemoryStorage();
  const adapter = new LocalStoragePurchasingAdapter(storage);

  adapter.saveMasterDocument(CLEAN_MASTER_TEMPLATE);
  adapter.saveProjectDocument('lot_3', getDefaultProjectDoc('lot_3', 'v1.0'));

  syncMasterPurchasingToProjects(adapter, ['lot_3']);
  let doc = adapter.getProjectDocument('lot_3');
  assert.equal((doc.match(/\n\n\n/g) || []).length, 0);

  let parsed = parseGoogleDocPurchasingStructure(doc);
  const ins1 = calculateSectionInsertion(parsed, 'Under cabinet LED strip lights', 2, 'electrical');
  const before1 = doc.slice(0, ins1.insertionIndex);
  const after1 = doc.slice(ins1.insertionIndex);
  doc = before1 + ins1.textToInsert + after1;
  adapter.saveProjectDocument('lot_3', doc);

  doc = adapter.getProjectDocument('lot_3');
  assert.ok(doc.includes('Under cabinet LED strip lights — Qty: 2'));
  assert.equal((doc.match(/\n\n\n/g) || []).length, 0, 'No 3+ newlines after adding item');

  syncMasterPurchasingToProjects(adapter, ['lot_3']);
  const docAfterResync = adapter.getProjectDocument('lot_3');
  assert.equal(docAfterResync, doc, 'Re-sync after item addition must be idempotent');

  parsed = parseGoogleDocPurchasingStructure(doc);
  const ins2 = calculateSectionInsertion(parsed, 'Garbage disposal', 1, 'plumbing');
  const before2 = doc.slice(0, ins2.insertionIndex);
  const after2 = doc.slice(ins2.insertionIndex);
  doc = before2 + ins2.textToInsert + after2;
  adapter.saveProjectDocument('lot_3', doc);

  doc = adapter.getProjectDocument('lot_3');
  assert.ok(doc.includes('Garbage disposal'));
  assert.equal((doc.match(/\n\n\n/g) || []).length, 0, 'No 3+ newlines after adding item');

  syncMasterPurchasingToProjects(adapter, ['lot_3']);
  const finalDoc = adapter.getProjectDocument('lot_3');
  assert.equal(finalDoc, doc, 'Final sync must be completely idempotent');
});

test('Scenario 4: Recovery from Legacy / CRLF / Multi-Page Whitespace Bloat', () => {
  const bloatedDoc = 'Applicable to all lots and standard builds.\r\n' + '\r\n'.repeat(60) +
    '## 1. Quartz Hardware\r\n- [ ] Electrical pass-through caps\r\n- [ ] Sinks\r\n' + '\r\n'.repeat(60) +
    '## 2. Electrical Hardware Fixtures\r\n- [ ] Security lights\r\n- [ ] Contractor\'s doorbell chime kit\r\n- [ ] Smart doorbell\r\n- [ ] Front porch hanging light\r\n- [ ] Exterior column lights\r\n- [ ] Garage ceiling lights with the cap to install it\r\n- [ ] Vanity lights\r\n- [ ] Smart switches\r\n- [ ] Extension rods\r\n- [ ] Ceiling fans\r\n' + '\r\n'.repeat(60) +
    '## 3. Plumbing Hardware Fixtures\r\n- [ ] Soap dispenser\r\n- [ ] Garbage disposal power button\r\n- [ ] Garbage disposal\r\n- [ ] Water heater with the water heater stand and tray\r\n- [ ] Shower kits\r\n- [ ] Toilets\r\n- [ ] Rough-in shower valves\r\n- [ ] Faucets\r\n<!-- section: general -->\r\n';

  const cleaned = normalizePurchasingDocumentSpacing(bloatedDoc);
  assert.equal(cleaned.includes('\r'), false, 'All \\r carriage returns must be eliminated');
  assert.equal(cleaned.includes('\n\n\n'), false, 'All triple newlines must be collapsed');
  assert.ok(cleaned.includes('Applicable to all lots and standard builds.\n\n## 1. Quartz Hardware'));
  assert.ok(cleaned.includes('## 1. Quartz Hardware\n- [ ] Electrical pass-through caps\n- [ ] Sinks\n\n## 2. Electrical Hardware Fixtures'));
  assert.ok(cleaned.includes('## 2. Electrical Hardware Fixtures\n- [ ] Security lights'));
  assert.ok(cleaned.includes('## 3. Plumbing Hardware Fixtures\n- [ ] Soap dispenser'));

  const parsed = parseGoogleDocPurchasingStructure(cleaned);
  assert.equal(parsed.sections.length, 3);
  const totalItems = parsed.sections.reduce((sum, s) => sum + s.items.length, 0);
  assert.equal(totalItems, 20);
});

test('Scenario 5: Write Boundary Direct Google Drive Write Normalization Guard', async () => {
  let capturedWriteContent = null;
  setCustomContentProvider({
    fetchDocumentContent: async () => ({ success: true, content: '' }),
    writeDocumentContent: async ({ content }) => {
      capturedWriteContent = content;
      return { success: true, state: DOCUMENT_STATES.DOCUMENT_WRITE_SUCCESS, updatedTime: new Date().toISOString() };
    }
  });

  const dirtyInput = '## 1. Quartz Hardware\r\n- [ ] Sinks\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n## 2. Electrical Hardware Fixtures\r\n- [ ] Vanity lights\r\n\r\n';
  const res = await writeDocumentContent({
    documentId: 'doc_test_123',
    content: dirtyInput
  });

  assert.equal(res.success, true);
  assert.ok(capturedWriteContent, 'writeDocumentContent must pass normalized content to provider');
  assert.equal(capturedWriteContent.includes('\r'), false);
  assert.equal(capturedWriteContent.includes('\n\n\n'), false);
  assert.equal(capturedWriteContent, '## 1. Quartz Hardware\n- [ ] Sinks\n\n## 2. Electrical Hardware Fixtures\n- [ ] Vanity lights\n');

  resetContentProvider();
});