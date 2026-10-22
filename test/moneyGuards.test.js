// v1.14.11: money guards found in the post go-live check (real functions, no copies).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  distributeReceiptTotalToSplits,
  draftSyncProblem,
  normalizeScanDate,
  splitsMatchTotal
} from '../src/services/editFormHelpers.js';
import { parseMoney } from '../src/services/money.js';

const cents = (list) => Math.round(list.reduce((sum, value) => sum + parseFloat(value), 0) * 100);

describe('splits always add up to the receipt total', () => {
  test('a return receipt (negative total) split evenly adds up exactly', () => {
    assert.deepEqual(distributeReceiptTotalToSplits([0, 0, 0], -10), ['-3.34', '-3.33', '-3.33']);
    assert.equal(cents(distributeReceiptTotalToSplits([0, 0, 0], -10)), -1000);
  });

  test('2,000 random receipts and returns, with and without item prices', () => {
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(Math.random() * 6);
      const withPrices = Math.random() < 0.5;
      const bases = Array.from({ length: n }, () => (withPrices ? Math.round(Math.random() * 30000) / 100 : 0));
      const sign = Math.random() < 0.3 ? -1 : 1;
      const total = sign * Math.round(Math.random() * 500000) / 100;
      assert.equal(cents(distributeReceiptTotalToSplits(bases, total)), Math.round(total * 100), `bases ${bases} total ${total}`);
    }
  });
});

describe('a draft only syncs when its splits add up', () => {
  const draft = (amount, splitAmounts) => ({
    vendor: 'Home Depot',
    amount,
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In',
    splits: splitAmounts?.map(a => ({ amount: a, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' }))
  });

  test('splits equal to the total (to the cent) can sync', () => {
    assert.equal(splitsMatchTotal(draft(156.6, [101.82, 3.05, 20.15, 31.58])), true);
    assert.equal(draftSyncProblem(draft(156.6, [101.82, 3.05, 20.15, 31.58])), null);
    assert.equal(splitsMatchTotal(draft(-10, ['-3.34', '-3.33', '-3.33'])), true);
  });

  test('a receipt with no splits is not affected', () => {
    assert.equal(splitsMatchTotal(draft(42)), true);
    assert.equal(draftSyncProblem(draft(42)), null);
  });

  test('splits off by even one cent are stopped, with both totals in the message', () => {
    assert.equal(splitsMatchTotal(draft(-10, [-3.34, -3.34, -3.34])), false);
    const problem = draftSyncProblem(draft(156.6, [101.82, 3.05, 20.15, 31.57]));
    assert.match(problem, /\$156\.59/);
    assert.match(problem, /\$156\.60/);
  });

  test('a missing phase is still reported first', () => {
    assert.match(draftSyncProblem({ vendor: 'X', amount: 5, tradeCategory: '', tradePhase: '' }), /needs a phase/);
  });
});

describe('reading amounts', () => {
  test('accounting negatives are negative', () => {
    assert.equal(parseMoney('(45.10)'), -45.1);
    assert.equal(parseMoney('$(1,234.50)'), -1234.5);
    assert.equal(parseMoney('45.10-'), -45.1);
  });

  test('normal amounts are unchanged', () => {
    assert.equal(parseMoney('$1,234.56'), 1234.56);
    assert.equal(parseMoney('-45.10'), -45.1);
    assert.equal(parseMoney(' $7.00 '), 7);
    assert.equal(parseMoney('abc'), 0);
    assert.equal(parseMoney('()'), 0);
    assert.equal(parseMoney(12.5), 12.5);
  });
});

describe('reading receipt dates', () => {
  test('written-out months', () => {
    assert.equal(normalizeScanDate('Oct 15, 2026'), '2026-10-15');
    assert.equal(normalizeScanDate('October 15 2026'), '2026-10-15');
    assert.equal(normalizeScanDate('Sept. 3, 2026'), '2026-09-03');
    assert.equal(normalizeScanDate('Foo 3, 2026'), '');
    assert.equal(normalizeScanDate('Feb 30, 2026'), '');
  });

  test('a time after the date is ignored', () => {
    assert.equal(normalizeScanDate('10/15/2026 2:14 PM'), '2026-10-15');
    assert.equal(normalizeScanDate('2026-10-15T14:22:00'), '2026-10-15');
  });

  test('the usual formats still work', () => {
    assert.equal(normalizeScanDate('10/15/26'), '2026-10-15');
    assert.equal(normalizeScanDate('15/10/2026'), '2026-10-15');
    assert.equal(normalizeScanDate('2/30/2026'), '');
  });
});
