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
