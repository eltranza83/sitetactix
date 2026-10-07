import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateDocumentPDF } from '../src/services/pdfGenerator.js';
import { getItemsForSplit } from '../src/services/editFormHelpers.js';

describe('getItemsForSplit', () => {
  const items = [
    { description: 'Mar Nova Dolomite', sku: '101349231', price: 124.95 },
    { description: 'Woodville Blanco', sku: '101329266', price: 24.3 },
    { description: 'Grout', sku: null, price: 12 }
  ];

  test('returns only the items assigned to that split, SKUs intact', () => {
    const allocations = { 0: 'a', 1: 'a', 2: 'b' };
    assert.deepEqual(getItemsForSplit(items, allocations, 'a').map(i => i.sku), ['101349231', '101329266']);
    assert.deepEqual(getItemsForSplit(items, allocations, 'b').map(i => i.description), ['Grout']);
  });

  test('returns nothing when there are no line items or allocations', () => {
    assert.deepEqual(getItemsForSplit(undefined, { 0: 'a' }, 'a'), []);
    assert.deepEqual(getItemsForSplit(items, undefined, 'a'), []);
    assert.deepEqual(getItemsForSplit(items, {}, 'a'), []);
  });
});

describe('document PDF with line items and long text', () => {
  test('builds a PDF with long category text, a long description and many line items', async () => {
    const blob = await generateDocumentPDF({
      lotNumber: 'Lot 3',
      description: 'Purchase of Mar Nova Dolomite Brass Pol II and Woodville Blanco tiles for the master bath, hall bath and laundry room floors and walls',
      vendor: 'Floor and Decor',
      date: '2026-02-01',
      costCategory: 'material',
      amount: 161.56,
      tradeCategory: 'Mechanicals_&_Utilities',
      tradePhase: 'Electrical & Lighting',
      lineItems: Array.from({ length: 25 }, (_, i) => ({
        description: `Item number ${i + 1} with a fairly long product description that should be cut to fit`,
        sku: `10134923${i}`,
        quantity: i + 1,
        price: 10 + i
      }))
    }, []);
    assert.ok(blob.size > 1000);
  });

  test('still builds a PDF with no line items', async () => {
    const blob = await generateDocumentPDF({
      lotNumber: 'Lot 3', description: 'Check', vendor: 'Sub', date: '2026-02-01', amount: 10
    }, []);
    assert.ok(blob.size > 1000);
  });
});

describe('normalizeScanDate', () => {
  test('turns common scanned formats into YYYY-MM-DD', async () => {
    const { normalizeScanDate } = await import('../src/services/editFormHelpers.js');
    assert.equal(normalizeScanDate('2026-02-01'), '2026-02-01');
    assert.equal(normalizeScanDate('02/01/2026'), '2026-02-01');
    assert.equal(normalizeScanDate('2/1/26'), '2026-02-01');
    assert.equal(normalizeScanDate('02-01-2026'), '2026-02-01');
    assert.equal(normalizeScanDate('2026/2/1'), '2026-02-01');
    assert.equal(normalizeScanDate(' 10/26/23 '), '2023-10-26');
  });

  test('reads a first number above 12 as the day', async () => {
    const { normalizeScanDate } = await import('../src/services/editFormHelpers.js');
    assert.equal(normalizeScanDate('26/10/2023'), '2023-10-26');
  });

  test('returns an empty string for blanks and things that are not dates', async () => {
    const { normalizeScanDate } = await import('../src/services/editFormHelpers.js');
    assert.equal(normalizeScanDate(''), '');
    assert.equal(normalizeScanDate(null), '');
    assert.equal(normalizeScanDate(undefined), '');
    assert.equal(normalizeScanDate('sometime in March'), '');
    assert.equal(normalizeScanDate('02/30/2026'), '');
    assert.equal(normalizeScanDate('13/13/2026'), '');
  });
});

describe('splitting a mixed receipt by each item\'s own category', () => {
  const main = { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' };
  const item = (description, tradeCategory, tradePhase) => ({ description, price: 1, tradeCategory, tradePhase });

  test('one split per category and phase, with the right items', async () => {
    const { planSplitsFromLineItems } = await import('../src/services/editFormHelpers.js');
    const groups = planSplitsFromLineItems([
      item('2IN PVC ELBOW', 'Mechanicals_&_Utilities', 'Plumbing Rough-In'),
      item('2-GANG WIRE BOX', 'Mechanicals_&_Utilities', 'Electrical & Lighting'),
      item('MAR NOVA DOLOMITE BRASS POL II', 'Paint_Tile', 'Tile & Flooring'),
      item('ROUGH-IN SHOWER VALVE', 'Mechanicals_&_Utilities', 'Plumbing Rough-In')
    ], main);
    assert.deepEqual(groups, [
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In', itemIndexes: [0, 3] },
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting', itemIndexes: [1] },
      { tradeCategory: 'Paint_Tile', tradePhase: 'Tile & Flooring', itemIndexes: [2] }
    ]);
  });

  test('a word like "brass" does not decide the trade; the scanned trade does', async () => {
    const { planSplitsFromLineItems } = await import('../src/services/editFormHelpers.js');
    const groups = planSplitsFromLineItems([
      item('MAR NOVA DOLOMITE BRASS POL II', 'Paint_Tile', 'Tile & Flooring'),
      item('CER 8X24 WOODVILLE BLANCO', 'Paint_Tile', 'Tile & Flooring')
    ], { tradeCategory: 'Paint_Tile', tradePhase: 'Tile & Flooring' });
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].itemIndexes, [0, 1]);
  });

  test('items with no or an invalid trade take the receipt\'s main trade', async () => {
    const { planSplitsFromLineItems } = await import('../src/services/editFormHelpers.js');
    const groups = planSplitsFromLineItems([
      { description: 'Mystery item', price: 1 },
      item('Bad pair', 'Paint_Tile', 'Plumbing Rough-In')
    ], main);
    assert.deepEqual(groups, [{ ...main, itemIndexes: [0, 1] }]);
  });

  test('no line items gives no groups', async () => {
    const { planSplitsFromLineItems } = await import('../src/services/editFormHelpers.js');
    assert.deepEqual(planSplitsFromLineItems(undefined, main), []);
    assert.deepEqual(planSplitsFromLineItems([], main), []);
  });

  test('pickSplitForItem uses the split with the item\'s trade, else the first split', async () => {
    const { pickSplitForItem } = await import('../src/services/editFormHelpers.js');
    const splits = [
      { id: 'a', tradeCategory: 'Paint_Tile', tradePhase: 'Tile & Flooring' },
      { id: 'b', tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting' }
    ];
    assert.equal(pickSplitForItem(item('x', 'Mechanicals_&_Utilities', 'Electrical & Lighting'), splits), 'b');
    assert.equal(pickSplitForItem(item('x', 'Interior_Finishes', 'Glass Work'), splits), 'a');
    assert.equal(pickSplitForItem({ description: 'x' }, splits), 'a');
    assert.equal(pickSplitForItem({ description: 'x' }, []), null);
  });

  test('the scan asks for a trade on every line item, from the same lists', async () => {
    const { GEMINI_RESPONSE_SCHEMA, DOCUMENT_EXTRACTION_PROMPT } = await import('../api/_lib/document-prompt.js');
    const props = GEMINI_RESPONSE_SCHEMA.properties.lineItems.items.properties;
    assert.deepEqual(props.tradeCategory.enum, GEMINI_RESPONSE_SCHEMA.properties.tradeCategory.enum);
    assert.deepEqual(props.tradePhase.enum, GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum);
    assert.ok(DOCUMENT_EXTRACTION_PROMPT.includes('LINE ITEM TRADES'));
  });
});

describe('drafts that start out already split', () => {
  const lineItems = [
    { description: '2IN PVC ELBOW', price: 4.5, sku: null, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
    { description: 'ROUGH-IN SHOWER VALVE', price: 89, sku: null, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
    { description: '2-GANG WIRE BOX', price: 2.8, sku: null, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting' },
    { description: 'DECORA LIGHT SWITCH (10PK)', price: 18.5, sku: null, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting' }
  ];
  const base = {
    lotNumber: 'Lot 3', amount: 156.6, costCategory: 'material',
    tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In', lineItems
  };

  test('items from two trades become two splits in the same lot that add up to the receipt total', async () => {
    const { buildAutoSplits } = await import('../src/services/editFormHelpers.js');
    const splits = buildAutoSplits(base);
    assert.equal(splits.length, 2);
    assert.deepEqual(splits.map(s => s.tradePhase), ['Plumbing Rough-In', 'Electrical & Lighting']);
    assert.deepEqual(splits.map(s => s.lotNumber), ['Lot 3', 'Lot 3']);
    assert.deepEqual(splits.map(s => s.itemIndexes), [[0, 1], [2, 3]]);
    assert.equal(splits[0].items.length, 2);
    const total = splits.reduce((sum, s) => sum + Math.round(s.amount * 100), 0);
    assert.equal(total, 15660);
    assert.equal(splits[0].description, '2IN PVC ELBOW, ROUGH-IN SHOWER VALVE');
  });

  test('a receipt in one trade, or with no items, is not split', async () => {
    const { buildAutoSplits } = await import('../src/services/editFormHelpers.js');
    assert.equal(buildAutoSplits({ ...base, lineItems: lineItems.slice(0, 2) }), null);
    assert.equal(buildAutoSplits({ ...base, lineItems: [] }), null);
    assert.equal(buildAutoSplits({ ...base, lineItems: undefined }), null);
    assert.equal(buildAutoSplits(undefined), null);
  });

  test('getItemIndexesForSplit lists the positions of a split\'s items', async () => {
    const { getItemIndexesForSplit } = await import('../src/services/editFormHelpers.js');
    assert.deepEqual(getItemIndexesForSplit(lineItems, { 0: 'a', 1: 'a', 2: 'b', 3: 'b' }, 'b'), [2, 3]);
    assert.deepEqual(getItemIndexesForSplit(undefined, { 0: 'a' }, 'a'), []);
  });
});

describe('scan rules for cost type, payment and vendor names', () => {
  test('labor only for paying a person for work; fuel and fees are material', async () => {
    const { DOCUMENT_EXTRACTION_PROMPT } = await import('../api/_lib/document-prompt.js');
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /"labor" ONLY when the document pays a person or subcontractor/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /fuel and gas/);
  });

  test('payment method goes in the check/payment field; vendor in normal capitalization', async () => {
    const { DOCUMENT_EXTRACTION_PROMPT } = await import('../api/_lib/document-prompt.js');
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /"Credit Card", "Debit Card" or "Cash"/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /not in all capitals/);
  });
});
