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
