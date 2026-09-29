import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSummaryPhaseMeta,
  findSummarySectionForSheet,
  finalizeBlock,
  getValByLabel,
  isFormulaError,
  isSummarySectionHeader,
  normalizeKey,
  normalizeSpreadsheetDate,
  parseCategorySheet,
  parseCurrency,
  parseSummaryDashboard
} from '../src/services/sheetsDataService.js';

test('basic spreadsheet helpers normalize labels and currency', () => {
  assert.equal(normalizeKey(' Paint & Tile '), 'painttile');
  assert.equal(parseCurrency('$1,255.50'), 1255.5);
  assert.equal(parseCurrency(''), 0);
  assert.equal(getValByLabel([['Project Name:', 'Lot 1']], 'project name'), 'Lot 1');
});

test('summary dashboard parser reads project labels despite row shifts', () => {
  const projectInfo = parseSummaryDashboard([
    [''],
    ['Project Name:', 'Lot 7'],
    ['Street Address:', '123 Main'],
    ['City, State, Zip:', 'Austin, TX'],
    ['Gross Projected Project Cost', '$400,000'],
    ['Net Working Capital Balance', '$9,600']
  ]);

  assert.equal(projectInfo.name, 'Lot 7');
  assert.equal(projectInfo.address, '123 Main');
  assert.equal(projectInfo.cityStateZip, 'Austin, TX');
  assert.equal(projectInfo.budgetGross, '$400,000');
  assert.equal(projectInfo.capitalBalance, '$9,600');
});

test('summary section matching handles sheet underscores and ampersands', () => {
  const paintSection = {
    name: 'PAINT & TILE',
    phases: [
      { phase: 'Tile & Flooring', materialCost: '$35.00', laborCost: '$0.00', combinedSpent: '$35.00' },
      { phase: 'Paint & Finishes', materialCost: '$5,600.00', laborCost: '$0.00', combinedSpent: '$5,600.00' }
    ]
  };
  const framingSection = { name: 'FRAMING LUMBER & TRUSS', phases: [] };

  assert.equal(findSummarySectionForSheet('Paint_Tile', [framingSection, paintSection]), paintSection);
  assert.equal(findSummarySectionForSheet('Framing_&_Lumber', [framingSection, paintSection]), framingSection);
});

test('summary section and phase metadata detection ignores total rows', () => {
  assert.equal(isSummarySectionHeader(['PAINT & TILE', '', '', '', '']), true);
  assert.equal(isSummarySectionHeader(['Paint & Finishes', '$5.00', '$0.00', '$5.00', 'In Progress']), false);
  assert.deepEqual(createSummaryPhaseMeta(['Paint & Finishes', '$5.00', '$2.00', '$7.00', 'In Progress']), {
    phase: 'Paint & Finishes',
    status: 'In Progress',
    materialCost: '$5.00',
    laborCost: '$2.00',
    combinedSpent: '$7.00'
  });
});

test('category parser uses Summary_Dashboard totals while keeping payee and balance from category sheet', () => {
  const summaryMeta = {
    phase: 'Paint & Finishes',
    status: 'In Progress',
    materialCost: '$33.00',
    laborCost: '$120.00',
    combinedSpent: '$153.00'
  };

  const contractors = parseCategorySheet(
    'Paint_Tile',
    [
      ['Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
      ['- Paint & Finishes', '', '$0.00', '$0.00', '', '', 'Painter Payee', '$0.00', '$1,000.00', '$847.00', 'Not Started'],
      ['primer', 'lowes', '$999.00', '', '', '', '', '', '', '', '']
    ],
    { [normalizeKey('Paint & Finishes')]: summaryMeta },
    { name: 'PAINT & TILE', phases: [summaryMeta] }
  );

  assert.equal(contractors.length, 1);
  assert.equal(contractors[0].phase, 'Paint & Finishes');
  assert.equal(contractors[0].payee, 'Painter Payee');
  assert.equal(contractors[0].remainingBalance, '$847.00');
  assert.equal(contractors[0].status, 'In Progress');
  assert.equal(contractors[0].totalMaterial, '$33.00');
  assert.equal(contractors[0].totalLabor, '$120.00');
  assert.equal(contractors[0].totalSpent, '$153.00');
  assert.equal(contractors[0].totalPaid, '$153.00');
  assert.equal(contractors[0].payments[0].materialCost, '$999.00');
});

test('finalizeBlock uses fallback summary phase metadata by position when phase names differ', () => {
  const contractor = finalizeBlock(
    {
      category: 'Framing & Lumber',
      phase: 'Framing Lumber & Truss',
      rows: [
        ['- Framing Lumber & Truss', '', '', '', '', '', 'Pedo Cedillo', '$1,200.00', '$15,400.00', '$14,200.00', 'Not Started']
      ]
    },
    {},
    {
      phase: 'Framing & Lumber',
      status: 'In Progress',
      materialCost: '$55.00',
      laborCost: '$1,200.00',
      combinedSpent: '$1,255.00'
    }
  );

  assert.equal(contractor.payee, 'Pedo Cedillo');
  assert.equal(contractor.status, 'In Progress');
  assert.equal(contractor.totalMaterial, '$55.00');
  assert.equal(contractor.totalLabor, '$1,200.00');
  assert.equal(contractor.totalPaid, '$1,255.00');
});

test('normalizeSpreadsheetDate handles Excel serial numbers and calendar strings', () => {
  assert.equal(normalizeSpreadsheetDate('46235.0'), '2026-08-01');
  assert.equal(normalizeSpreadsheetDate(46235), '2026-08-01');
  assert.equal(normalizeSpreadsheetDate('46225'), '2026-07-22');
  assert.equal(normalizeSpreadsheetDate('45225.0'), '2023-10-26');
  assert.equal(normalizeSpreadsheetDate('44197'), '2021-01-01');
  assert.equal(normalizeSpreadsheetDate('2026-08-15'), '2026-08-15');
  assert.equal(normalizeSpreadsheetDate('08/15/2026'), '08/15/2026');
  assert.equal(normalizeSpreadsheetDate(''), 'N/A');
  assert.equal(normalizeSpreadsheetDate(null), 'N/A');
});

test('isFormulaError identifies all spreadsheet error strings', () => {
  assert.equal(isFormulaError('#REF!'), true);
  assert.equal(isFormulaError('#VALUE!'), true);
  assert.equal(isFormulaError('#DIV/0!'), true);
  assert.equal(isFormulaError('#N/A'), true);
  assert.equal(isFormulaError('#NAME?'), true);
  assert.equal(isFormulaError('$1,200.00'), false);
  assert.equal(isFormulaError('0'), false);
});

test('formula errors preserve exact sheet, cellRef, and field context', () => {
  const summary = parseSummaryDashboard([
    ['Project Name:', 'Lot 3'],
    ['Gross Projected Project Cost', '#REF!'],
    ['Total Spent to Date (Draws)', '#VALUE!']
  ]);

  assert.equal(summary.hasFormulaError, true);
  assert.equal(summary.formulaErrors.length, 2);
  assert.equal(summary.formulaErrors[0].field, 'Gross Projected Project Cost');
  assert.equal(summary.formulaErrors[0].error, '#REF!');
  assert.equal(summary.formulaErrors[1].field, 'Total Spent to Date (Draws)');
  assert.equal(summary.formulaErrors[1].error, '#VALUE!');

  const categoryRows = [
    ['Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
    ['→ Electrical & Lighting', '', '$0.00', '$0.00', '', '', 'Electrical Payee', '$0.00', '$15,000.00', '#REF!', 'In Progress']
  ];

  const parsed = parseCategorySheet('Mechanicals_&_Utilities', categoryRows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].hasFormulaError, true);
  assert.equal(parsed[0].formulaErrors.length, 1);
  assert.equal(parsed[0].formulaErrors[0].cellRef, 'J2');
  assert.equal(parsed[0].formulaErrors[0].field, 'Remaining Balance');
  assert.equal(parsed[0].formulaErrors[0].error, '#REF!');
});

test('template-generated blank/formula rows do NOT create phantom payment transactions', () => {
  const rows = [
    ['Task Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans #', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
    ['→ Plumbing Rough-In', 'Plumbing Payee', '', '', '', '', '', '', '$10,000.00', '$10,000.00', 'Not Started']
  ];

  // Add 50 blank template formula rows
  for (let i = 0; i < 50; i++) {
    rows.push(['', '', '$0.00', '$0.00', '', '', '', '', '', '', '']);
  }

  // Add 1 real payment transaction
  rows.push(['PVC Pipes & Fittings', 'Ferguson Supply', '$1,250.00', '$0.00', '46235.0', '1042', '', '', '', '', '']);

  const parsed = parseCategorySheet('Mechanicals_&_Utilities', rows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].payments.length, 1, 'Only the 1 real payment transaction must be logged, ignoring 50 template rows');
  assert.equal(parsed[0].payments[0].vendor, 'Ferguson Supply');
  assert.equal(parsed[0].payments[0].materialCost, '$1,250.00');
  assert.equal(parsed[0].payments[0].date, '2026-08-01');
  assert.equal(parsed[0].payments[0].checkNumber, '1042');
});

test('unbounded row range reads transactions beyond row 80 and enables AI retrieval', async () => {
  const { executeClientToolCall } = await import('../src/services/aiTools.js');

  const rows = [
    ['Task Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans #', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
    ['→ Electrical & Lighting', 'Electrical Payee', '', '', '', '', '', '', '$25,000.00', '$16,550.00', 'In Progress']
  ];

  // Pad out to row 120 with template blanks
  for (let r = 2; r <= 120; r++) {
    rows.push(['', '', '$0.00', '$0.00', '', '', '', '', '', '', '']);
  }

  // Row 121: Transaction at row 121 (well beyond row 80)
  rows.push(['Industrial Circuit Breakers Pack', 'Apex Industrial Supply', '$8,450.00', '$0.00', '46235.0', '5042', '', '', '', '', '']);

  const parsed = parseCategorySheet('Mechanicals_&_Utilities', rows);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].payments.length, 1);
  assert.equal(parsed[0].payments[0].vendor, 'Apex Industrial Supply');
  assert.equal(parsed[0].payments[0].materialCost, '$8,450.00');
  assert.equal(parsed[0].payments[0].date, '2026-08-01');

  // Verify search_receipts finds the row 121 transaction
  const mockDashboardData = {
    projectInfo: { name: 'Lot 3' },
    subcontractors: parsed
  };

  const receiptResult = await executeClientToolCall('search_receipts', { query: 'Apex Industrial' }, { dashboardData: mockDashboardData });
  assert.equal(receiptResult.found, true);
  assert.equal(receiptResult.count, 1);
  assert.equal(receiptResult.receipts[0].payee, 'Apex Industrial Supply');
  assert.equal(receiptResult.receipts[0].amount, 8450);
  assert.equal(receiptResult.receipts[0].date, '2026-08-01');
  assert.equal(receiptResult.receipts[0].checkNumber, '5042');
});

test('subcontractor payee section keeps contractorPaid separate from material store receipts in AI retrieval', async () => {
  const { executeClientToolCall } = await import('../src/services/aiTools.js');

  const summaryMeta = {
    phase: 'Electrical & Lighting',
    status: 'In Progress',
    materialCost: '$143.80',
    laborCost: '$5,000.00',
    combinedSpent: '$5,143.80'
  };

  const rows = [
    ['Task Description', 'Contractor / Vendor', 'Material Cost', 'Labor Cost', 'Payment Date', 'Check or Trans #', 'Contractor Payee', 'Total Paid', 'Original Quote', 'Remaining Balance', 'Notes / Status'],
    ['→ Electrical & Lighting', '', '', '', '', '', 'Enrique Vallejo', '$5,000.00', '$15,000.00', '$10,000.00', 'In Progress'],
    ['Rough-in labor draw 1', 'Enrique Vallejo', '$0.00', '$5,000.00', '2026-08-15', '1245', '', '', '', '', ''],
    ['Outlet boxes and conduits', 'Home Depot', '$143.80', '$0.00', '2026-08-16', 'N/A', '', '', '', '', '']
  ];

  const parsed = parseCategorySheet(
    'Mechanicals_&_Utilities',
    rows,
    { [normalizeKey('Electrical & Lighting')]: summaryMeta },
    { name: 'MECHANICALS & UTILITIES', phases: [summaryMeta] }
  );

  assert.equal(parsed.length, 1);
  const trade = parsed[0];
  assert.equal(trade.payee, 'Enrique Vallejo');
  assert.equal(trade.contractorPaid, '$5,000.00');
  assert.equal(trade.originalQuote, '$15,000.00');
  assert.equal(trade.remainingBalance, '$10,000.00');
  assert.equal(trade.totalLabor, '$5,000.00');
  assert.equal(trade.totalMaterial, '$143.80');
  assert.equal(trade.totalSpent, '$5,143.80');

  // Verify AI tool get_subcontractor_balance reports contractor paid and balance truthfully without conflating Home Depot
  const mockDashboardData = {
    projectInfo: { name: 'Lot 3' },
    subcontractors: parsed
  };

  const balanceResult = await executeClientToolCall('get_subcontractor_balance', { tradeOrContractor: 'electrician' }, { dashboardData: mockDashboardData });
  assert.equal(balanceResult.found, true);
  assert.equal(balanceResult.foundCount, 1);
  assert.equal(balanceResult.results[0].contractor, 'Enrique Vallejo');
  assert.equal(balanceResult.results[0].quote, 15000);
  assert.equal(balanceResult.results[0].totalPaid, 5000);
  assert.equal(balanceResult.results[0].contractorPaid, 5000);
  assert.equal(balanceResult.results[0].remainingBalance, 10000);
  assert.equal(balanceResult.results[0].phaseSpent, 5143.8);
});
