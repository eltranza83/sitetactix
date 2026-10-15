import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatMoney, parseMoney } from '../src/services/money.js';
import { recalculateSplits } from '../src/services/editFormHelpers.js';
import { getDisplayImageUrl } from '../src/services/imageFiles.js';

test('parseMoney reads numbers and Sheet text, anything else is 0', () => {
  assert.equal(parseMoney(1234.5), 1234.5);
  assert.equal(parseMoney('$1,234.50'), 1234.5);
  assert.equal(parseMoney('-$500.00'), -500);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney('abc'), 0);
  assert.equal(parseMoney(NaN), 0);
  assert.equal(parseMoney(Infinity), 0);
});

test('formatMoney shows cents, commas and negatives the same way everywhere', () => {
  assert.equal(formatMoney(2156.6), '$2,156.60');
  assert.equal(formatMoney('15000'), '$15,000.00');
  assert.equal(formatMoney(-500), '-$500.00');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(undefined), '$0.00');
  assert.equal(formatMoney(0.1 + 0.2), '$0.30');
});

test("formatMoney 'auto' drops .00 on whole dollars only", () => {
  assert.equal(formatMoney(15000, { cents: 'auto' }), '$15,000');
  assert.equal(formatMoney(20.15, { cents: 'auto' }), '$20.15');
  assert.equal(formatMoney(20.1, { cents: 'auto' }), '$20.10');
  assert.equal(formatMoney(-500, { cents: 'auto' }), '-$500');
  assert.equal(formatMoney(237843.4, { cents: 'auto' }), '$237,843.40');
});

test('no screen or service formats or parses dollars on its own any more', () => {
  const files = [
    'src/components/Dashboard.jsx',
    'src/components/DashboardKpiCards.jsx',
    'src/components/DashboardTradeSections.jsx',
    'src/components/DashboardContractorDetail.jsx',
    'src/components/DashboardContractorSearch.jsx',
    'src/components/DashboardOverpaidNotice.jsx',
    'src/components/DashboardTodayCheck.jsx',
    'src/services/dailyCheck.js',
    'src/services/sheetV2.js',
    'src/services/projectSheet.js',
    'src/services/spreadsheetHealth.js'
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes("replace(/[^0-9.-]/g"), `${file} parses dollars itself`);
    assert.ok(!/minimumFractionDigits/.test(source), `${file} formats dollars itself`);
  }
});

const homeDepot = [
  { description: 'PVC fittings', price: '93.50' },
  { description: 'Wire box', price: '2.80' },
  { description: 'Deck screws', price: '28.90' },
  { description: 'Decora switches', price: '18.60' }
];

test('recalculateSplits spreads the receipt total (with tax) by the items in each split', () => {
  const splits = [
    { id: 'a', amount: '', description: '' },
    { id: 'b', amount: '', description: '' }
  ];
  const result = recalculateSplits(splits, homeDepot, { 0: 'a', 1: 'b', 2: 'b', 3: 'b' }, '156.60');
  assert.deepEqual(result.map(s => s.amount), ['101.82', '54.78']);
  assert.equal(result[1].description, 'Wire box, Deck screws, Decora switches');
  const total = result.reduce((sum, s) => sum + Math.round(parseFloat(s.amount) * 100), 0);
  assert.equal(total, 15660);
});

test('recalculateSplits keeps amounts and descriptions typed by hand', () => {
  const splits = [
    { id: 'a', amount: '100.00', description: 'Plumbing stuff' },
    { id: 'b', amount: '', description: '' }
  ];
  const result = recalculateSplits(splits, homeDepot, { 0: 'a', 1: 'b', 2: 'b', 3: 'b' }, '156.60', {
    manualAmounts: { a: true },
    manualDescriptions: { a: true }
  });
  assert.equal(result[0].amount, '100.00');
  assert.equal(result[0].description, 'Plumbing stuff');
  assert.equal(result[1].amount, '54.78');
});

test('recalculateSplits returns the same list when nothing changes (no endless re-render)', () => {
  const splits = [
    { id: 'a', amount: '101.82', description: 'PVC fittings' },
    { id: 'b', amount: '54.78', description: 'Wire box, Deck screws, Decora switches' }
  ];
  const result = recalculateSplits(splits, homeDepot, { 0: 'a', 1: 'b', 2: 'b', 3: 'b' }, '156.60');
  assert.equal(result, splits);
});

test('getDisplayImageUrl prefers the offline copy, then a Drive thumbnail', () => {
  assert.equal(getDisplayImageUrl('https://drive.google.com/file/d/abc_123/view', 'data:image/jpeg;base64,xx'), 'data:image/jpeg;base64,xx');
  assert.equal(getDisplayImageUrl('https://drive.google.com/file/d/abc_123/view', null), 'https://drive.google.com/thumbnail?id=abc_123&sz=w400');
  assert.equal(getDisplayImageUrl('https://drive.google.com/open?id=xyz', null, 'w1000'), 'https://drive.google.com/thumbnail?id=xyz&sz=w1000');
  assert.equal(getDisplayImageUrl('', null), '');
  assert.equal(getDisplayImageUrl('https://example.com/a.jpg', null), 'https://example.com/a.jpg');
});
