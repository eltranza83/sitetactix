/**
 * MONEY CHECK — a sample house run through the real code, start to finish:
 * scanned receipts and checks -> payee matching -> automatic splits -> Transactions rows
 * -> the Dashboard numbers the app shows. Every expected number below was worked out by hand.
 * If a change breaks the money math, this fails, CI fails, and Vercel does not publish.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { applyPayeeMatch } from '../src/services/payeeMatching.js';
import { buildAutoSplits } from '../src/services/editFormHelpers.js';
import { buildSplitMetadata } from '../src/services/invoiceUpload.js';
import {
  buildKnownSubs,
  buildTransactionRow,
  computeV2Dashboard,
  formatPerSqFt,
  paidToSub
} from '../src/services/sheetV2.js';

const PROJECT_INFO_ROWS = [
  ['Field', 'Value'],
  ['Project Name', 'Lot 77 - Money Check'],
  ['Street Address', '100 Test St'],
  ['City, State, Zip', 'McAllen, TX 78504'],
  ['Development Scope', 'New Spec Home'],
  ['Budget for Build (Hard Costs)', 240000],
  ['Lot Cost (Land)', 70500],
  ['Total Sq Ft', 2700],
  ['Living Sq Ft', 2200]
];

const CONTRACT_ROWS = [
  ['Sub', 'Company', 'Category', 'Phase', 'Quote'],
  ['Enrique Vallejo', 'Lucen LLC', 'Mechanicals & Utilities', 'Electrical & Lighting', 15000],
  ['Pedro Salinas', 'Salinas Plumbing', 'Mechanicals & Utilities', 'Plumbing Rough-In', 9000],
  ['Oscar Garza', '', 'Framing & Lumber', 'Framing Lumber & Truss', 18000]
];

const KNOWN_SUBS = buildKnownSubs(CONTRACT_ROWS);

const labor = (vendor, amount, checkNumber, tradeCategory, tradePhase, date) => ({
  vendor, amount, checkNumber, tradeCategory, tradePhase, date,
  costCategory: 'labor', description: 'Labor payment'
});

// What the scanner hands back, before the app touches it
const SCANNED = [
  labor('Lucen', 2000, '1050', 'Mechanicals_&_Utilities', 'Electrical & Lighting', '2026-10-09'),
  labor('Enrique Vallejo', 2000, '1545', 'Mechanicals_&_Utilities', 'Electrical & Lighting', '2026-10-11'),
  labor('Pedro Salinas', 3000, '1600', 'Mechanicals_&_Utilities', 'Plumbing Rough-In', '2026-10-12'),
  labor('Oscar Garza', 10000, '1700', 'Framing_&_Lumber', 'Framing Lumber & Truss', '2026-10-13'),
  labor('Oscar Garza', 8500, '1750', 'Framing_&_Lumber', 'Framing Lumber & Truss', '2026-10-20'),
  {
    vendor: 'Imco Lumber', amount: 340.47, costCategory: 'material', date: '2026-05-21',
    description: 'Closet rods and brackets', tradeCategory: 'Interior_Finishes', tradePhase: 'Cabinets & Trim Carpentry'
  },
  {
    // One Home Depot receipt: $144.60 of items + $12.00 tax = $156.60, items in 4 different phases
    vendor: 'Home Depot', amount: 156.60, costCategory: 'material', date: '2026-10-14',
    description: 'Mixed supplies', tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In',
    lineItems: [
      { description: 'PVC ELBOW', price: 60.00, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
      { description: 'ROUGH-IN VALVE', price: 34.00, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
      { description: 'WIRE BOX', price: 3.00, tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting' },
      { description: 'DECORA SWITCH', price: 18.60, tradeCategory: 'Interior_Hardware', tradePhase: 'Electrical Hardware Fixtures' },
      { description: 'DECK SCREWS', price: 29.00, tradeCategory: 'Framing_&_Lumber', tradePhase: 'Framing Lumber & Truss' }
    ]
  }
];

/** Same path the app takes: payee match on scan, auto-split, one Transactions row per receipt or split. */
function syncToTransactionRows(scanned) {
  const rows = [['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check / Payment', 'Receipt', 'Receipt ID']];
  scanned.forEach((raw, i) => {
    const draftId = `draft_${i + 1}`;
    const metadata = applyPayeeMatch(raw, KNOWN_SUBS);
    const splits = buildAutoSplits(metadata);
    if (splits) {
      splits.forEach((split, splitIndex) => {
        const splitMetadata = buildSplitMetadata(metadata, split, draftId, splitIndex);
        rows.push(buildTransactionRow(splitMetadata, { receiptId: splitMetadata.receiptId }));
      });
    } else {
      rows.push(buildTransactionRow(metadata, { receiptId: draftId }));
    }
  });
  return rows;
}

const TRANSACTION_ROWS = syncToTransactionRows(SCANNED);
const dashboard = computeV2Dashboard({
  projectInfoRows: PROJECT_INFO_ROWS,
  transactionRows: TRANSACTION_ROWS,
  contractRows: CONTRACT_ROWS
});
const phase = (name) => dashboard.subcontractors.find(s => s.phase === name);
const category = (name) => dashboard.categories.find(c => c.name === name);
const contract = (sub) => dashboard.contracts.find(c => c.sub === sub);
const cents = (value) => Math.round(value * 100);

describe('MONEY CHECK: payee names', () => {
  test('"Lucen" on a check is saved as Lucen LLC', () => {
    assert.equal(applyPayeeMatch(SCANNED[0], KNOWN_SUBS).vendor, 'Lucen LLC');
  });
});

describe('MONEY CHECK: one receipt split across phases', () => {
  const splits = buildAutoSplits(SCANNED[6]);

  test('the receipt is split 4 ways, tax spread by size, adding up to the receipt to the cent', () => {
    assert.deepEqual(splits.map(s => [s.tradePhase, s.amount]), [
      ['Plumbing Rough-In', 101.80],
      ['Electrical & Lighting', 3.25],
      ['Electrical Hardware Fixtures', 20.14],
      ['Framing Lumber & Truss', 31.41]
    ]);
    assert.equal(cents(splits.reduce((sum, s) => sum + s.amount, 0)), cents(156.60));
  });

  test('each split becomes its own Transactions row with its own Receipt ID', () => {
    const splitRows = TRANSACTION_ROWS.filter(r => String(r[9]).startsWith('draft_7_split_'));
    assert.equal(splitRows.length, 4);
    assert.deepEqual(splitRows.map(r => r[5]), [101.80, 3.25, 20.14, 31.41]);
    splitRows.forEach(r => assert.equal(r[6], ''));
  });
});

describe('MONEY CHECK: Transactions', () => {
  test('labor goes in Labor, materials in Material, never both', () => {
    TRANSACTION_ROWS.slice(1).forEach(r => {
      const hasMaterial = r[5] !== '';
      const hasLabor = r[6] !== '';
      assert.ok(hasMaterial !== hasLabor, `row for ${r[1]} must have exactly one amount`);
    });
  });

  test('10 rows: 5 sub payments, 1 receipt, 4 splits', () => {
    assert.equal(TRANSACTION_ROWS.length - 1, 10);
  });
});

describe('MONEY CHECK: Dashboard totals', () => {
  const info = dashboard.projectInfo;

  test('Spent = $497.07 materials + $25,500 labor = $25,997.07', () => {
    assert.equal(info.totalSpent, 25997.07);
  });

  test('Still owed to subs = $11,000 (Enrique) + $6,000 (Pedro); Oscar overpaid by $500 counts as $0, not -$500', () => {
    assert.equal(info.stillOwed, 17000);
  });

  test('Budget remaining, after subs, gross and projected', () => {
    assert.equal(info.budgetGross, 310500);
    assert.equal(info.budgetRemaining, 214002.93);
    assert.equal(info.budgetAfterSubs, 197002.93);
    assert.equal(info.projectedBuildCost, 42997.07);
  });

  test('Cost per sq ft (build and all-in, per living and per total)', () => {
    assert.deepEqual(info.costPerSqFt, {
      buildPerLiving: 19.54,
      buildPerTotal: 15.92,
      allInPerLiving: 51.59,
      allInPerTotal: 42.04
    });
    assert.equal(formatPerSqFt(info.costPerSqFt.allInPerLiving), '$52');
  });

  test('the phases add up to the Dashboard total, and so do the categories', () => {
    const phaseTotal = dashboard.subcontractors.reduce((sum, s) => sum + cents(s.totalSpent), 0);
    const categoryTotal = dashboard.categories.reduce((sum, c) => sum + cents(c.totalPaid), 0);
    assert.equal(phaseTotal, cents(info.totalSpent));
    assert.equal(categoryTotal, cents(info.totalSpent));
  });
});

describe('MONEY CHECK: each sub', () => {
  test('Enrique Vallejo (Lucen LLC): both checks count, whichever name was on them', () => {
    const c = contract('Enrique Vallejo');
    assert.equal(c.displayName, 'Enrique Vallejo (Lucen LLC)');
    assert.equal(c.paid, 4000);
    assert.equal(c.stillOwed, 11000);
  });

  test('Pedro Salinas: $3,000 paid of $9,000', () => {
    assert.equal(contract('Pedro Salinas').paid, 3000);
    assert.equal(contract('Pedro Salinas').stillOwed, 6000);
  });

  test('Oscar Garza: paid $18,500 on an $18,000 quote shows -$500 on his own card', () => {
    assert.equal(contract('Oscar Garza').paid, 18500);
    assert.equal(contract('Oscar Garza').stillOwed, -500);
  });

  test('materials bought for a phase never count as paid to its sub', () => {
    const electrical = phase('Electrical & Lighting');
    assert.equal(electrical.totalMaterial, 3.25);
    assert.equal(electrical.totalLabor, 4000);
    assert.equal(paidToSub(electrical), 4000);
    assert.equal(electrical.remainingBalance, 11000);

    const framing = phase('Framing Lumber & Truss');
    assert.equal(framing.totalMaterial, 31.41);
    assert.equal(paidToSub(framing), 18500);
  });

  test('a phase with only materials shows $0 paid to a sub', () => {
    assert.equal(paidToSub(phase('Cabinets & Trim Carpentry')), 0);
    assert.equal(phase('Cabinets & Trim Carpentry').totalMaterial, 340.47);
    assert.equal(paidToSub(phase('Electrical Hardware Fixtures')), 0);
  });
});

describe('MONEY CHECK: categories', () => {
  test('Mechanicals & Utilities: $105.05 materials + $7,000 labor = $7,105.05, $17,000 still owed', () => {
    const mech = category('Mechanicals & Utilities');
    assert.equal(mech.totalMaterial, 105.05);
    assert.equal(mech.totalLabor, 7000);
    assert.equal(mech.totalPaid, 7105.05);
    assert.equal(mech.totalOwed, 17000);
  });

  test('Framing & Lumber $18,531.41; Interior Hardware $20.14; Interior Finishes $340.47', () => {
    assert.equal(category('Framing & Lumber').totalPaid, 18531.41);
    assert.equal(category('Interior Hardware').totalPaid, 20.14);
    assert.equal(category('Interior Finishes').totalPaid, 340.47);
  });
});
