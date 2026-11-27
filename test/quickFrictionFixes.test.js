import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createManualExpenseDraft } from '../src/services/stagedDocumentOperations.js';
import { filterHistoryItems } from '../src/services/historySync.js';

describe('manual expense draft creation', () => {
  it('pre-fills today date, active lot, and no_receipt metadata without attaching any image', () => {
    const fixedDate = new Date(2026, 10, 27, 10, 0, 0);
    const draft = createManualExpenseDraft({ id: 'lot3', name: 'Lot 3 – SiteTactix' }, fixedDate);

    assert.equal(draft.isNewManualDraft, true);
    assert.equal(draft.mainImageBase64, null);
    assert.equal(draft.secondaryImageBase64, null);
    assert.equal(draft.metadata.documentType, 'manual_expense');
    assert.equal(draft.metadata.receiptStatus, 'no_receipt');
    assert.equal(draft.metadata.provenance, 'manual_user_entry');
    assert.equal(draft.metadata.date, '2026-11-27');
    assert.equal(draft.metadata.lotNumber, 'Lot 3 – SiteTactix');
    assert.equal(draft.metadata.costCategory, 'material');
  });
});

describe('History search and Mat/Lab filtering', () => {
  const sampleHistory = [
    {
      id: 'h1',
      vendor: 'Magic Valley Concrete',
      description: '3500 PSI concrete mix',
      costCategory: 'material',
      tradeCategory: 'Site_Prep_&_Structure',
      tradePhase: 'Foundation & Flatwork',
      dateTransaction: '2026-09-28',
      checkNumber: '1430',
      amount: 11400
    },
    {
      id: 'h2',
      vendor: 'RG Concrete',
      description: 'Final slab pour & finish',
      costCategory: 'labor',
      tradeCategory: 'Site_Prep_&_Structure',
      tradePhase: 'Foundation & Flatwork',
      dateTransaction: '2026-10-02',
      checkNumber: '1432',
      amount: 9000
    },
    {
      id: 'h3',
      vendor: 'Home Depot',
      description: 'PEX fittings and valves',
      costCategory: 'material',
      tradeCategory: 'Mechanicals_&_Utilities',
      tradePhase: 'Plumbing Rough-In',
      dateTransaction: '2026-10-10',
      checkNumber: '',
      amount: 245.5
    }
  ];

  it('filters by cost category (Material vs Labor)', () => {
    assert.deepEqual(filterHistoryItems(sampleHistory, { costFilter: 'labor' }).map(i => i.id), ['h2']);
    assert.deepEqual(filterHistoryItems(sampleHistory, { costFilter: 'material' }).map(i => i.id), ['h1', 'h3']);
  });

  it('matches vendor, description, phase, check number, and amount', () => {
    assert.deepEqual(filterHistoryItems(sampleHistory, { query: '1432' }).map(i => i.id), ['h2']);
    assert.deepEqual(filterHistoryItems(sampleHistory, { query: 'plumbing' }).map(i => i.id), ['h3']);
    assert.deepEqual(filterHistoryItems(sampleHistory, { query: 'concrete', costFilter: 'material' }).map(i => i.id), ['h1']);
    assert.deepEqual(filterHistoryItems(sampleHistory, { query: '245.5' }).map(i => i.id), ['h3']);
  });
});
