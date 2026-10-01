import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distributeReceiptTotalToSplits,
  checkLineItemsDiscrepancy,
  isDraftPhaseValid,
  isValidPhase
} from '../src/services/editFormHelpers.js';

test('1. distributeReceiptTotalToSplits matches exact live testing example with proportional tax', () => {
  // Example: $93.50 + $50.30 items with $12.80 tax ($156.60 total) -> $101.82 + $54.78
  const baseItems = [93.50, 50.30];
  const receiptTotal = 156.60;
  const result = distributeReceiptTotalToSplits(baseItems, receiptTotal);

  assert.deepEqual(result, ['101.82', '54.78']);
  const sum = result.reduce((acc, v) => acc + parseFloat(v), 0);
  assert.equal(Math.round(sum * 100), Math.round(receiptTotal * 100));
});

test('2. distributeReceiptTotalToSplits places leftover rounding cents on the largest split', () => {
  // Clear largest split gets the leftover cent when rounding leaves a difference
  const baseItems1 = [33.33, 33.33, 33.34];
  const receiptTotal1 = 100.01; // $0.01 tax, 1 * (3334/10000) rounds to 0, leftover +0.01 goes to largest (split 3)
  const result1 = distributeReceiptTotalToSplits(baseItems1, receiptTotal1);

  assert.equal(result1[0], '33.33');
  assert.equal(result1[1], '33.33');
  assert.equal(result1[2], '33.35');
  const sum1 = result1.reduce((acc, v) => acc + parseFloat(v), 0);
  assert.equal(Math.round(sum1 * 100), Math.round(receiptTotal1 * 100));

  // Non-tied: largest split clearly identified
  const baseItems2 = [70.00, 30.00];
  const receiptTotal2 = 100.01;
  const result2 = distributeReceiptTotalToSplits(baseItems2, receiptTotal2);
  assert.equal(result2[0], '70.01');
  assert.equal(result2[1], '30.00');
  const sum2 = result2.reduce((acc, v) => acc + parseFloat(v), 0);
  assert.equal(Math.round(sum2 * 100), Math.round(receiptTotal2 * 100));
});

test('3. distributeReceiptTotalToSplits handles 3 or more splits with tax', () => {
  const baseItems = [40.00, 30.00, 30.00];
  const receiptTotal = 108.25; // $8.25 tax
  const result = distributeReceiptTotalToSplits(baseItems, receiptTotal);

  assert.equal(result.length, 3);
  const sum = result.reduce((acc, v) => acc + parseFloat(v), 0);
  assert.equal(Math.round(sum * 100), Math.round(receiptTotal * 100));
  // Split 1: 40/100 * 8.25 = 3.30 -> 43.30
  // Split 2: 30/100 * 8.25 = 2.475 -> 2.48 -> 32.48
  // Split 3: 30/100 * 8.25 = 2.475 -> 2.48 -> 32.48 (rounded sum = 108.26, leftover -0.01 to largest -> 43.29)
  assert.equal(result[0], '43.29');
  assert.equal(result[1], '32.48');
  assert.equal(result[2], '32.48');
});

test('4. distributeReceiptTotalToSplits handles store discounts / negative delta', () => {
  const baseItems = [60.00, 40.00];
  const receiptTotal = 90.00; // $10 store discount
  const result = distributeReceiptTotalToSplits(baseItems, receiptTotal);

  assert.deepEqual(result, ['54.00', '36.00']);
  const sum = result.reduce((acc, v) => acc + parseFloat(v), 0);
  assert.equal(Math.round(sum * 100), Math.round(receiptTotal * 100));
});

test('5. distributeReceiptTotalToSplits strictly matches receipt total across arbitrary variations', () => {
  const testCases = [
    { base: [10, 20], total: 32.50 },
    { base: [1.99, 5.49, 12.00], total: 21.05 },
    { base: [100.50, 200.75, 50.25], total: 380.00 },
    { base: [0.01, 0.02, 0.03], total: 0.10 },
    { base: [156.60], total: 156.60 }
  ];

  for (const { base, total } of testCases) {
    const result = distributeReceiptTotalToSplits(base, total);
    const sumCents = result.reduce((acc, val) => acc + Math.round(parseFloat(val) * 100), 0);
    const expectedCents = Math.round(total * 100);
    assert.equal(sumCents, expectedCents, `Sum mismatch for base ${JSON.stringify(base)} and total ${total}`);
  }
});

test('6. isDraftPhaseValid falls back to metadata.tradeCategory when split has no tradeCategory', () => {
  const validDraft = {
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In',
    splits: [
      { tradePhase: 'Plumbing Rough-In' }, // inherits Mechanicals_&_Utilities
      { tradeCategory: 'Interior_Finishes', tradePhase: 'Drywall & Sheetrock' }
    ]
  };

  assert.equal(isDraftPhaseValid(validDraft), true);

  const invalidDraft = {
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In',
    splits: [
      { tradePhase: 'Drywall & Sheetrock' } // not valid under Mechanicals_&_Utilities
    ]
  };

  assert.equal(isDraftPhaseValid(invalidDraft), false);
});

test('7. checkLineItemsDiscrepancy flags misreads over 15% and accepts normal tax', () => {
  // Normal tax: $143.80 items on $156.60 receipt -> ~8.2% difference
  const normalTax = checkLineItemsDiscrepancy(143.80, 156.60);
  assert.equal(normalTax.isDiscrepant, false);

  // Large discrepancy: $96.00 items on $156.60 receipt -> $60.60 diff (38.7%)
  const misread = checkLineItemsDiscrepancy(96.00, 156.60);
  assert.equal(misread.isDiscrepant, true);
  assert.equal(misread.diff.toFixed(2), '60.60');

  // Exact match
  const exact = checkLineItemsDiscrepancy(100.00, 100.00);
  assert.equal(exact.isDiscrepant, false);
});
