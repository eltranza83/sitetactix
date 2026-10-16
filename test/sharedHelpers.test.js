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

test('a punch item with no pin (null) is not treated as a pin in the corner', async () => {
  const { hasFloorPlanPin, pinCoordinate } = await import('../src/services/floorPlanPin.js');
  assert.equal(hasFloorPlanPin({ floorPlanX: null, floorPlanY: null }), false);
  assert.equal(hasFloorPlanPin({}), false);
  assert.equal(hasFloorPlanPin({ floorPlanX: '', floorPlanY: '' }), false);
  assert.equal(hasFloorPlanPin({ floorPlanX: 42.5, floorPlanY: 18.25 }), true);
  assert.equal(hasFloorPlanPin({ floorPlanX: 0, floorPlanY: 0 }), true);
  assert.equal(pinCoordinate(null), null);
  assert.equal(pinCoordinate('12.5'), 12.5);
});

test('no file checks pins with a plain number test any more', () => {
  for (const file of ['src/components/BlueprintCanvasView.jsx', 'src/components/IssueFormModal.jsx', 'src/hooks/useIssues.js',
    'src/services/floorPlanSnapshot.js', 'src/services/issuePacketShare.js', 'src/services/pdfGenerator.js']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/isFinite\(Number\([^)]*floorPlan/.test(source), `${file} checks a pin with Number()`);
  }
});

test('punch packets use the Subdivision saved on the project', async () => {
  const { getProjectPacketInfo } = await import('../src/services/projectInfoFormatter.js');
  const saved = getProjectPacketInfo({}, 'Lot 99 -New Test', '', 'Northwood Trail');
  assert.equal(saved.subdivision, 'Northwood Trail');
  assert.equal(saved.lotNumber, 'Lot 99');
  const guessed = getProjectPacketInfo({}, 'Lot 5 – Northwood Trail', '');
  assert.equal(guessed.subdivision, '– Northwood Trail');
});

test('a $0 split gets no History entry (it is never uploaded), and Receipt IDs keep their split number', async () => {
  const { buildHistoryLogs } = await import('../src/services/invoiceUpload.js');
  const logs = buildHistoryLogs({
    vendor: 'Home Depot',
    date: '2023-10-26',
    splits: [
      { amount: '133.40', tradePhase: 'Plumbing Rough-In' },
      { amount: '0.00', tradePhase: 'Framing Lumber & Truss' },
      { amount: '23.20', tradePhase: 'Electrical & Lighting' }
    ]
  }, { idPrefix: 'x', link: null, draftId: 'draft1' });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map(l => l.amount), ['133.40', '23.20']);
  assert.deepEqual(logs.map(l => l.id), ['x_split_0', 'x_split_2']);
  assert.notEqual(logs[0].receiptId, logs[1].receiptId);
});

test('dropEmptySplits removes $0 splits with no items, but never empties the list', async () => {
  const { dropEmptySplits } = await import('../src/services/editFormHelpers.js');
  const plumbing = { id: 'a', amount: 133.4, items: [{ description: 'PVC' }] };
  const emptyFraming = { id: 'd', amount: 0, items: [] };
  const typedByHand = { id: 'e', amount: 25, items: [] };
  assert.deepEqual(dropEmptySplits([plumbing, emptyFraming, typedByHand]), [plumbing, typedByHand]);
  const zeroWithItems = { id: 'f', amount: 0, items: [{ description: 'free sample' }] };
  assert.deepEqual(dropEmptySplits([plumbing, zeroWithItems]), [plumbing, zeroWithItems]);
  const allEmpty = [{ id: 'x', amount: 0, items: [] }, { id: 'y', amount: '0.00', items: [] }];
  assert.equal(dropEmptySplits(allEmpty), allEmpty);
});

test('formatPhone shows US numbers as (956) 821-2514 and leaves anything else as typed', async () => {
  const { formatPhone } = await import('../src/services/projectInfoFormatter.js');
  assert.equal(formatPhone('19568212514'), '(956) 821-2514');
  assert.equal(formatPhone('9568212514'), '(956) 821-2514');
  assert.equal(formatPhone('+1 956-821-2514'), '(956) 821-2514');
  assert.equal(formatPhone('(956) 821-2514'), '(956) 821-2514');
  assert.equal(formatPhone('821-2514'), '821-2514');
  assert.equal(formatPhone(''), '');
  assert.equal(formatPhone(null), '');
});

test('punch status names: the saved in_progress value shows as "Fix submitted"', async () => {
  const { issueStatusLabel } = await import('../src/services/issueStatus.js');
  assert.equal(issueStatusLabel('open'), 'Open');
  assert.equal(issueStatusLabel('in_progress'), 'Fix submitted');
  assert.equal(issueStatusLabel('resolved'), 'Resolved');
  assert.equal(issueStatusLabel(undefined), 'Open');
});

test('no screen asks with the browser pop-up (OK highlighted); all questions use confirmAction', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]
  ));
  const offenders = walk('src')
    .filter(file => /\.(js|jsx)$/.test(file) && !file.endsWith('confirmAction.js'))
    .filter(file => /(window\.confirm|[^\w.]confirm)\(/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('isGoogleThumbnail accepts only Google thumbnail hosts', async () => {
  const { isGoogleThumbnail } = await import('../src/services/imageFiles.js');
  assert.equal(isGoogleThumbnail('https://lh3.googleusercontent.com/drive-storage/abc=s220'), true);
  assert.equal(isGoogleThumbnail('https://drive.google.com/thumbnail?id=abc'), false);
  assert.equal(isGoogleThumbnail('https://evil.example/googleusercontent.com'), false);
  assert.equal(isGoogleThumbnail(''), false);
  assert.equal(isGoogleThumbnail(undefined), false);
});

test('isGoogleThumbnail rejects non-https links', async () => {
  const { isGoogleThumbnail } = await import('../src/services/imageFiles.js');
  assert.equal(isGoogleThumbnail('http://lh3.googleusercontent.com/abc=s220'), false);
});

test('dataUrlToBlob keeps the type and bytes', async () => {
  const { dataUrlToBlob } = await import('../src/services/imageFiles.js');
  const blob = dataUrlToBlob(`data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), '%PDF-1.4');
  assert.equal(dataUrlToBlob('not a data url').type, 'image/jpeg');
});
