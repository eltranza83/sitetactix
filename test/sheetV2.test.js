import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHEET_LAYOUT_LEGACY,
  SHEET_LAYOUT_V2,
  V2_CATEGORIES,
  buildKnownSubs,
  buildProjectInfoValues,
  buildTransactionRow,
  canonicalPhaseName,
  categoryDisplayName,
  collectReceiptIds,
  computeV2Dashboard,
  detectSheetLayout,
  fetchV2DashboardData,
  getReceiptId,
  parseProjectInfo,
  writeProjectInfo
} from '../src/services/sheetV2.js';
import { buildReceiptId } from '../src/services/invoiceUpload.js';
import { GEMINI_RESPONSE_SCHEMA } from '../api/_lib/document-prompt.js';

const TX_HEADER = ['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check / Payment', 'Receipt', 'Receipt ID'];
const CONTRACTS_HEADER = ['Sub', 'Company (name on checks)', 'Category', 'Phase', 'Quote', 'Paid', 'Still owed'];

function tx(payee, category, phase, material, labor, id) {
  return ['2026-09-01', payee, 'Test', category, phase, material || '', labor || '', '1001', '', id];
}

// The spec's Lot 3 sample data
const SAMPLE = {
  projectInfoRows: [
    ['Project Info'],
    ['Project Name', 'Lot 3 – Northwood Trail'],
    ['Street Address', ''],
    ['City, State, Zip', 'McAllen, TX 78504'],
    ['Development Scope', 'Single Family Residence Plan'],
    ['Budget for Build (Hard Costs)', 240000],
    ['Lot Cost (Land)', '$70,500.00']
  ],
  transactionRows: [
    TX_HEADER,
    tx('City of McAllen', 'Paperwork & Permits', 'Paperwork & Permits', 3120, 0, 't1'),
    tx('Valley Concrete', 'Site Prep & Structure', 'Foundation & Flatwork', 6200, 0, 't2'),
    tx('Juan Garza', 'Site Prep & Structure', 'Foundation & Flatwork', 0, 4800, 't3'),
    tx('ABC Supply', 'Site Prep & Structure', 'Roofing', 2100, 0, 't4'),
    tx('Roof Crew', 'Site Prep & Structure', 'Roofing', 0, 1500, 't5'),
    tx('84 Lumber', 'Framing & Lumber', 'Framing Lumber & Truss', 8480, 0, 't6'),
    tx('Framers Inc', 'Framing & Lumber', 'Framing Lumber & Truss', 0, 4500, 't7'),
    tx('Ferguson', 'Mechanicals & Utilities', 'Plumbing Rough-In', 1840, 0, 't8'),
    tx('Plumb Pro', 'Mechanicals & Utilities', 'Plumbing Rough-In', 0, 2500, 't9'),
    tx('Home Depot', 'Mechanicals & Utilities', 'Electrical & Lighting', 1200, 0, 't10'),
    tx('Enrique Vallejo', 'Mechanicals & Utilities', 'Electrical & Lighting', 0, 5000, 't11'),
    tx('Vallejo Electric LLC', 'Mechanicals & Utilities', 'Electrical & Lighting', 0, 3000, 't12'),
    tx('Johnstone Supply', 'Mechanicals & Utilities', 'HVAC / AC Systems', 900, 0, 't13'),
    tx('Rio Cool Air', 'Mechanicals & Utilities', 'HVAC / AC Systems', 0, 5600, 't14'),
    tx('Floor and Decor', 'Paint & Tile', 'Tile & Flooring', 1940, 0, 't15'),
    tx('Pedro Salinas', 'Paint & Tile', 'Tile & Flooring', 0, 3000, 't16'),
    tx('Ferguson', 'Interior Hardware', 'Plumbing Hardware Fixtures', 760, 0, 't17'),
    tx('Home Depot', 'Interior Hardware', 'Electrical Hardware Fixtures', 450, 0, 't18'),
    tx('Lowe\'s', 'House Exterior & Yard', 'Fencing & Gates', 650, 0, 't19'),
    tx('Fence Guys', 'House Exterior & Yard', 'Fencing & Gates', 0, 1000, 't20'),
    tx('AEP Texas', 'Project Overhead & Bills', 'Monthly Utility Bills', 380, 0, 't21'),
    tx('Waste Connections', 'Project Overhead & Bills', 'Dumpsters & Cleaning', 620, 0, 't22')
  ],
  contractRows: [
    CONTRACTS_HEADER,
    ['Enrique Vallejo', 'Vallejo Electric LLC', 'Mechanicals & Utilities', 'Electrical & Lighting', 15000],
    ['Pedro Salinas', '', 'Paint & Tile', 'Tile & Flooring', 9500],
    ['Rio Cool Air', 'Rio Cool Air', 'Mechanicals & Utilities', 'HVAC / AC Systems', 11200],
    ['SecureHome Alarms', 'SecureHome Alarms', 'Mechanicals & Utilities', 'Insulation & Alarms', 2300]
  ]
};

describe('new Sheet layout detection', () => {
  test('v2 only when both Transactions and Project Info tabs exist', () => {
    assert.equal(detectSheetLayout(['Dashboard', 'Contracts', 'Project Info', 'Lists', 'Transactions']), SHEET_LAYOUT_V2);
    assert.equal(detectSheetLayout(['Transactions']), SHEET_LAYOUT_LEGACY);
    assert.equal(detectSheetLayout(['Project Info']), SHEET_LAYOUT_LEGACY);
    assert.equal(detectSheetLayout(['Summary_Dashboard', 'Paint_Tile', 'New_Invoices']), SHEET_LAYOUT_LEGACY);
    assert.equal(detectSheetLayout(undefined), SHEET_LAYOUT_LEGACY);
  });
});

describe('Transactions rows', () => {
  test('every scan category key maps to its Sheet display name', () => {
    assert.equal(V2_CATEGORIES.length, 9);
    assert.equal(V2_CATEGORIES.reduce((n, c) => n + c.phases.length, 0), 26);
    const keys = GEMINI_RESPONSE_SCHEMA.properties.tradeCategory.enum;
    keys.forEach(key => assert.ok(V2_CATEGORIES.some(c => c.key === key), key));
    assert.equal(categoryDisplayName('Mechanicals_&_Utilities'), 'Mechanicals & Utilities');
    assert.equal(categoryDisplayName('Paint_Tile'), 'Paint & Tile');
    assert.equal(categoryDisplayName('Project_Overhead_&_Bills'), 'Project Overhead & Bills');
    assert.equal(categoryDisplayName('Paint & Tile'), 'Paint & Tile');
    // every scan phase is one of the 26
    GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum.forEach(phase => assert.equal(canonicalPhaseName(phase), phase));
    assert.equal(canonicalPhaseName('Framing'), 'Framing Lumber & Truss');
  });

  test('a material receipt fills A:J in spec order with a plain receipt link', () => {
    const row = buildTransactionRow({
      date: '2026-09-14', vendor: 'Home Depot', description: 'Wire and boxes',
      tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting',
      costCategory: 'material', amount: 412.5, checkNumber: 'Credit Card'
    }, { receiptId: 'draft_1', fileUrl: 'https://drive.google.com/file/d/abc/view' });
    assert.deepEqual(row, [
      '2026-09-14', 'Home Depot', 'Wire and boxes', 'Mechanicals & Utilities', 'Electrical & Lighting',
      412.5, '', 'Credit Card', 'https://drive.google.com/file/d/abc/view', 'draft_1'
    ]);
  });

  test('labor goes in G; text that looks like a formula stays text', () => {
    const row = buildTransactionRow({
      vendor: '=Enrique', description: '+rough in', tradeCategory: 'Mechanicals_&_Utilities',
      tradePhase: 'Electrical & Lighting', costCategory: 'labor', amount: '5,000.00', checkNumber: '1043', date: '2026-09-01'
    }, { receiptId: 'r2' });
    assert.equal(row[1], "'=Enrique");
    assert.equal(row[2], "'+rough in");
    assert.equal(row[5], '');
    assert.equal(row[6], 5000);
    assert.equal(row[7], '1043');
    assert.equal(row[8], '');
  });

  test('each split of a receipt gets its own row and Receipt ID', () => {
    const base = { vendor: 'Lowe\'s', date: '2026-09-02', checkNumber: 'Cash' };
    const splits = [
      { ...base, amount: 120, costCategory: 'material', tradeCategory: 'Paint_Tile', tradePhase: 'Tile & Flooring', description: 'Thinset', receiptId: buildReceiptId('draft_9', 0) },
      { ...base, amount: 80, costCategory: 'material', tradeCategory: 'Interior_Hardware', tradePhase: 'Plumbing Hardware Fixtures', description: 'Faucet', receiptId: buildReceiptId('draft_9', 1) }
    ];
    const rows = splits.map(m => buildTransactionRow(m, { receiptId: getReceiptId({ id: 'drive_file' }, m) }));
    assert.equal(rows[0][3], 'Paint & Tile');
    assert.equal(rows[1][3], 'Interior Hardware');
    assert.deepEqual(rows.map(r => r[9]), ['draft_9_split_0', 'draft_9_split_1']);
    assert.equal(buildReceiptId('draft_9'), 'draft_9');
    // Without an app id the Drive file id is used
    assert.equal(getReceiptId({ id: 'drive_file' }, {}), 'drive_file');
  });

  test('Receipt IDs already in column J are collected for dedupe', () => {
    const ids = collectReceiptIds([['a'], [], ['  b '], [''], ['draft_9_split_0']]);
    assert.ok(ids.has('a') && ids.has('b') && ids.has('draft_9_split_0'));
    assert.equal(ids.size, 3);
  });
});

describe('Project Info', () => {
  test('read by label, amounts as numbers', () => {
    const info = parseProjectInfo(SAMPLE.projectInfoRows);
    assert.deepEqual(info, {
      name: 'Lot 3 – Northwood Trail',
      address: '',
      cityStateZip: 'McAllen, TX 78504',
      scope: 'Single Family Residence Plan',
      budgetBuild: 240000,
      lotCost: 70500
    });
    // Rows in a different order still read by label
    assert.equal(parseProjectInfo([['Lot Cost (Land)', '1,000'], ['Street Address', '12 Oak']]).lotCost, 1000);
  });

  test('written as B2:B7 in row order', async () => {
    const values = buildProjectInfoValues({
      name: 'Lot 4', address: '14 Northwood Trail', cityStateZip: 'McAllen, TX 78504',
      scope: 'Single Family Residence Plan', budgetBuild: '$250,000', lotCost: ''
    });
    assert.deepEqual(values, [['Lot 4'], ['14 Northwood Trail'], ['McAllen, TX 78504'], ['Single Family Residence Plan'], [250000], ['']]);

    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, options) => {
        calls.push({ url: decodeURIComponent(String(url)), options });
        return { ok: true, json: async () => ({}) };
      };
      await writeProjectInfo('tok', 'sheet_1', { name: 'Lot 4', budgetBuild: 250000 });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /sheet_1\/values\/'Project Info'!B2:B7\?valueInputOption=USER_ENTERED$/);
      assert.equal(calls[0].options.method, 'PUT');
      assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
      assert.equal(JSON.parse(calls[0].options.body).values.length, 6);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('v2 Dashboard math (spec sample)', () => {
  const data = computeV2Dashboard(SAMPLE);
  const info = data.projectInfo;

  test('budget numbers', () => {
    assert.equal(info.layout, 'v2');
    assert.equal(info.totalSpent, 59540);
    assert.equal(info.stillOwed, 21400);
    assert.equal(info.budgetRemaining, 180460);
    assert.equal(info.budgetAfterSubs, 159060);
    assert.equal(info.projectedBuildCost, 80940);
    assert.equal(info.budgetGross, 310500);
    assert.equal(info.budgetBuild, 240000);
    assert.equal(info.budgetLand, 70500);
    assert.equal(info.cityStateZip, 'McAllen, TX 78504');
    assert.equal('deposits' in info, false);
    assert.equal('capitalBalance' in info, false);
  });

  test('paid per contract counts checks to the Sub or the Company', () => {
    const byPhase = Object.fromEntries(data.contracts.map(c => [c.sub, c]));
    assert.equal(byPhase['Enrique Vallejo'].paid, 8000);
    assert.equal(byPhase['Enrique Vallejo'].stillOwed, 7000);
    assert.equal(byPhase['Pedro Salinas'].paid, 3000);
    assert.equal(byPhase['Rio Cool Air'].paid, 5600);
    assert.equal(byPhase['SecureHome Alarms'].paid, 0);
    assert.equal(byPhase['SecureHome Alarms'].stillOwed, 2300);
  });

  test('per phase and per category totals, all 26 phases present', () => {
    assert.equal(data.subcontractors.length, 26);
    const electrical = data.subcontractors.find(s => s.phase === 'Electrical & Lighting');
    assert.equal(electrical.totalMaterial, 1200);
    assert.equal(electrical.totalLabor, 8000);
    assert.equal(electrical.totalSpent, 9200);
    assert.equal(electrical.originalQuote, 15000);
    assert.equal(electrical.contractorPaid, 8000);
    assert.equal(electrical.remainingBalance, 7000);
    assert.equal(electrical.payee, 'Vallejo Electric LLC');
    assert.equal(electrical.payments.length, 3);
    const insulation = data.subcontractors.find(s => s.phase === 'Insulation & Alarms');
    assert.equal(insulation.totalSpent, 0);
    assert.equal(insulation.remainingBalance, 2300);

    assert.equal(data.categories.length, 9);
    const mech = data.categories.find(c => c.name === 'Mechanicals & Utilities');
    assert.equal(mech.totalMaterial, 3940);
    assert.equal(mech.totalLabor, 16100);
    assert.equal(mech.totalPaid, 20040);
    assert.equal(mech.phasesCount, 4);
    const sum = data.categories.reduce((n, c) => n + c.totalPaid, 0);
    assert.equal(sum, 59540);
  });

  test('reads the three data tabs in one request (never the Dashboard tab)', async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    try {
      globalThis.fetch = async (url) => {
        seenUrl = decodeURIComponent(String(url));
        return {
          ok: true,
          json: async () => ({
            valueRanges: [
              { values: SAMPLE.projectInfoRows },
              { values: SAMPLE.transactionRows },
              { values: SAMPLE.contractRows }
            ]
          })
        };
      };
      const fetched = await fetchV2DashboardData('tok', 'sheet_1');
      assert.equal(fetched.projectInfo.totalSpent, 59540);
      assert.match(seenUrl, /'Project Info'!A1:B20/);
      assert.match(seenUrl, /Transactions!A1:J/);
      assert.match(seenUrl, /Contracts!A1:E/);
      assert.doesNotMatch(seenUrl, /Dashboard/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('empty new Sheet works out to zeros', () => {
    const empty = computeV2Dashboard({ projectInfoRows: [], transactionRows: [TX_HEADER], contractRows: [CONTRACTS_HEADER] });
    assert.equal(empty.projectInfo.totalSpent, 0);
    assert.equal(empty.projectInfo.stillOwed, 0);
    assert.equal(empty.subcontractors.length, 26);
  });

  test('known subs list comes from Contracts Sub/Company', () => {
    assert.deepEqual(buildKnownSubs(SAMPLE.contractRows), [
      { sub: 'Enrique Vallejo', company: 'Vallejo Electric LLC' },
      { sub: 'Pedro Salinas', company: '' },
      { sub: 'Rio Cool Air', company: 'Rio Cool Air' },
      { sub: 'SecureHome Alarms', company: 'SecureHome Alarms' }
    ]);
  });
});
