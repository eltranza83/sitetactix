import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NEW_OVERHEAD_PHASES,
  classifyOverheadPhase,
  upgradeOverheadPhasesInSheet
} from '../src/services/overheadSheetUpgrade.js';

describe('classifyOverheadPhase', () => {
  test('accurately classifies Lot 3 real receipts', () => {
    assert.equal(
      classifyOverheadPhase({ payee: 'El Tigre Exxon', description: 'Gasoline - fuel purchase at the pump' }),
      'Fuel & Gas'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'Best Buy', description: 'HP 910XL High-Yield Ink Cartridge' }),
      'Office & Tech'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'Mint Mobile', description: 'Mint mobile 6 Month 23GB Plan SIM Kits' }),
      'Office & Tech'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'Google LLC', description: 'Google AI Pro (5 TB) subscription' }),
      'Office & Tech'
    );
  });

  test('classifies Food & Crew and Tools & Supplies examples', () => {
    assert.equal(
      classifyOverheadPhase({ payee: 'Whataburger', description: 'Crew lunch burgers and drinks' }),
      'Food & Crew'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'HEB', description: 'Gatorade and bottled water cases' }),
      'Food & Crew'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'Harbor Freight', description: 'Extension cords and saw blades' }),
      'Tools & Supplies'
    );
    assert.equal(
      classifyOverheadPhase({ payee: 'Home Depot', description: 'Heavy duty tarps and padlocks' }),
      'Tools & Supplies'
    );
  });

  test('returns null for ambiguous misc items so they stay in Extra Costs & Misc', () => {
    assert.equal(classifyOverheadPhase({ payee: 'Local Hardware', description: 'Misc jobsite expense' }), null);
    assert.equal(classifyOverheadPhase({ payee: 'John Doe', description: 'Reimbursement for miscellaneous fee' }), null);
    assert.equal(classifyOverheadPhase({ payee: '', description: '' }), null);
  });
});

function buildBlockColumnA(phases) {
  const col = [
    ['Project Overhead & Bills'],
    ['Totals'],
    [''],
    [''],
    ['']
  ];
  phases.forEach(phase => {
    col.push([phase]);       // bandRow
    col.push(['Date']);      // header
    for (let i = 0; i < 10; i++) col.push(['']); // 10 receipt rows
    col.push(['QUOTES']);    // quotesRow (bandRow + 12)
    for (let i = 0; i < 4; i++) col.push(['']);  // 4 quote rows
    col.push(['']);          // 1 spacer row (total 18 rows)
  });
  return col;
}

describe('upgradeOverheadPhasesInSheet', () => {
  test('upgrades Lists, validations, Project Overhead & Bills blocks, and Transactions, and is idempotent on second run', async () => {
    // Mutable in-memory Google Sheet state to verify both first run and idempotent second run
    const state = {
      lists: [
        ['Categories', 'Phases'],
        ['Paperwork & Permits', 'Paperwork & Permits'],
        ['Site Prep & Structure', 'Foundation & Flatwork'],
        ['Framing & Lumber', 'Framing Lumber & Truss'],
        ['Mechanicals & Utilities', 'Plumbing Rough-In'],
        ['Interior Finishes', 'Drywall & Sheetrock'],
        ['Paint & Tile', 'Tile & Flooring'],
        ['Interior Hardware', 'Plumbing Hardware Fixtures'],
        ['House Exterior & Yard', 'Stucco & Masonry'],
        ['Project Overhead & Bills', 'Monthly Utility Bills'],
        ['', 'Dumpsters & Cleaning'],
        ['', 'Extra Costs & Misc']
      ],
      txValidation: {
        condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$B$2:$B$12' }] },
        strict: true,
        showCustomUi: true
      },
      contractsValidation: {
        condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$B$2:$B$12' }] },
        strict: true,
        showCustomUi: true
      },
      overheadColA: buildBlockColumnA(['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Extra Costs & Misc']),
      dashboardRows: [
        ['Dashboard Summary'],
        ['Monthly Utility Bills', '=SUMIF(...)'],
        ['Dumpsters & Cleaning', '=SUMIF(...)'],
        ['Extra Costs & Misc', '=SUMIF(...)']
      ],
      transactions: [
        ['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check / Payment', 'Receipt', 'Receipt ID'],
        ['2026-09-01', 'El Tigre Exxon', 'Gasoline - fuel purchase at the pump', 'Project Overhead & Bills', 'Extra Costs & Misc', 65, '', 'Credit Card', '', 'r_fuel'],
        ['2026-09-02', 'Best Buy', 'HP 910XL High-Yield Ink Cartridge', 'Project Overhead & Bills', 'Extra Costs & Misc', 89, '', 'Credit Card', '', 'r_ink'],
        ['2026-09-03', 'Mint Mobile', 'Mint mobile 6 Month 23GB Plan SIM Kits', 'Project Overhead & Bills', 'Extra Costs & Misc', 120, '', 'Credit Card', '', 'r_sim'],
        ['2026-09-04', 'Google LLC', 'Google AI Pro (5 TB) subscription', 'Project Overhead & Bills', 'Extra Costs & Misc', 20, '', 'Credit Card', '', 'r_google'],
        ['2026-09-05', 'Misc Vendor', 'Unusual misc fee', 'Project Overhead & Bills', 'Extra Costs & Misc', 50, '', 'Cash', '', 'r_misc'],
        ['2026-09-06', 'Home Depot', 'Extension cords', 'Mechanicals & Utilities', 'Electrical & Lighting', 40, '', 'Credit Card', '', 'r_other_cat']
      ]
    };

    const recordedBatchUpdates = [];
    const recordedValueUpdates = [];

    const mockFetch = async (url, options = {}) => {
      const decoded = decodeURIComponent(String(url));
      const method = options.method || 'GET';

      if (method === 'GET' && decoded.includes('dataValidation')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [
              {
                properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 5000 } },
                data: [{ rowData: [{ values: [{}, { dataValidation: state.txValidation }] }] }]
              },
              {
                properties: { sheetId: 4, title: 'Contracts', gridProperties: { rowCount: 500 } },
                data: [{ rowData: [{ values: [{}, { dataValidation: state.contractsValidation }] }] }]
              }
            ]
          })
        };
      }

      if (method === 'GET' && decoded.includes('gridProperties(rowCount,columnCount)')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [
              { properties: { sheetId: 1, title: 'Dashboard', gridProperties: { rowCount: 100, columnCount: 12 } } },
              { properties: { sheetId: 2, title: 'Project Info', gridProperties: { rowCount: 50, columnCount: 5 } } },
              { properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 5000, columnCount: 10 } } },
              { properties: { sheetId: 4, title: 'Contracts', gridProperties: { rowCount: 500, columnCount: 7 } } },
              { properties: { sheetId: 5, title: 'Lists', gridProperties: { rowCount: 100, columnCount: 10 } } },
              { properties: { sheetId: 6, title: 'Project Overhead & Bills', gridProperties: { rowCount: 200, columnCount: 10 } } }
            ]
          })
        };
      }

      if (method === 'GET' && decoded.includes("'Lists'!A1:Z100")) {
        return { ok: true, json: async () => ({ values: state.lists }) };
      }

      if (method === 'GET' && decoded.includes("'Project Overhead & Bills'!A1:A2000")) {
        return { ok: true, json: async () => ({ values: state.overheadColA }) };
      }

      if (method === 'GET' && decoded.includes("'Dashboard'!A1:L100")) {
        return { ok: true, json: async () => ({ values: state.dashboardRows }) };
      }

      if (method === 'GET' && decoded.includes('Transactions!A1:J')) {
        return { ok: true, json: async () => ({ values: state.transactions }) };
      }

      if (method === 'POST' && decoded.includes('/values:batchUpdate')) {
        const body = JSON.parse(options.body);
        recordedValueUpdates.push(body);
        for (const item of body.data) {
          if (item.range.startsWith("'Lists'!B")) {
            const match = item.range.match(/B(\d+):B(\d+)/);
            const startRow = Number(match[1]) - 1;
            item.values.forEach((val, idx) => {
              const r = startRow + idx;
              while (state.lists.length <= r) state.lists.push(['', '']);
              state.lists[r][1] = val[0];
            });
          } else if (item.range.startsWith('Transactions!E')) {
            const rowNum = Number(item.range.replace('Transactions!E', ''));
            state.transactions[rowNum - 1][4] = item.values[0][0];
          }
        }
        return { ok: true, json: async () => ({}) };
      }

      if (method === 'POST' && decoded.includes(':batchUpdate')) {
        const body = JSON.parse(options.body);
        recordedBatchUpdates.push(body);
        for (const req of body.requests) {
          if (req.setDataValidation) {
            if (req.setDataValidation.range.sheetId === 3) state.txValidation = req.setDataValidation.rule;
            if (req.setDataValidation.range.sheetId === 4) state.contractsValidation = req.setDataValidation.rule;
          } else if (req.insertDimension && req.insertDimension.range.sheetId === 6) {
            const { startIndex, endIndex } = req.insertDimension.range;
            const count = endIndex - startIndex;
            const blanks = Array.from({ length: count }, () => ['']);
            state.overheadColA.splice(startIndex, 0, ...blanks);
          } else if (req.copyPaste && req.copyPaste.source.sheetId === 6) {
            const { source, destination } = req.copyPaste;
            const slice = state.overheadColA.slice(source.startRowIndex, source.endRowIndex).map(r => [...r]);
            for (let i = 0; i < slice.length; i++) {
              state.overheadColA[destination.startRowIndex + i] = slice[i];
            }
          } else if (req.findReplace && req.findReplace.range.sheetId === 6) {
            const { startRowIndex, endRowIndex } = req.findReplace.range;
            for (let r = startRowIndex; r < endRowIndex; r++) {
              if (state.overheadColA[r]?.[0] === req.findReplace.find) {
                state.overheadColA[r][0] = req.findReplace.replacement;
              }
            }
          } else if (req.insertDimension && req.insertDimension.range.sheetId === 1) {
            const { startIndex, endIndex } = req.insertDimension.range;
            const blanks = Array.from({ length: endIndex - startIndex }, () => ['', '']);
            state.dashboardRows.splice(startIndex, 0, ...blanks);
          } else if (req.copyPaste && req.copyPaste.source.sheetId === 1) {
            const { source, destination } = req.copyPaste;
            state.dashboardRows[destination.startRowIndex] = [...state.dashboardRows[source.startRowIndex]];
          } else if (req.findReplace && req.findReplace.range.sheetId === 1) {
            const r = req.findReplace.range.startRowIndex;
            state.dashboardRows[r] = state.dashboardRows[r].map(c =>
              c === req.findReplace.find ? req.findReplace.replacement : c
            );
          }
        }
        return { ok: true, json: async () => ({}) };
      }

      throw new Error(`Unexpected request: ${method} ${decoded}`);
    };

    // First run
    const first = await upgradeOverheadPhasesInSheet('tok', 'sheet_lot3', mockFetch);

    assert.deepEqual(first.addedPhases, NEW_OVERHEAD_PHASES);
    assert.deepEqual(first.reclassified, [
      { rowNumber: 2, receiptId: 'r_fuel', payee: 'El Tigre Exxon', newPhase: 'Fuel & Gas' },
      { rowNumber: 3, receiptId: 'r_ink', payee: 'Best Buy', newPhase: 'Office & Tech' },
      { rowNumber: 4, receiptId: 'r_sim', payee: 'Mint Mobile', newPhase: 'Office & Tech' },
      { rowNumber: 5, receiptId: 'r_google', payee: 'Google LLC', newPhase: 'Office & Tech' }
    ]);

    // Verify Categories column A in Lists was NOT shifted or altered
    assert.deepEqual(
      state.lists.slice(1, 10).map(r => r[0]),
      [
        'Paperwork & Permits',
        'Site Prep & Structure',
        'Framing & Lumber',
        'Mechanicals & Utilities',
        'Interior Finishes',
        'Paint & Tile',
        'Interior Hardware',
        'House Exterior & Yard',
        'Project Overhead & Bills'
      ]
    );

    // Verify Lists column B now has the 4 new phases right before Extra Costs & Misc
    assert.deepEqual(
      state.lists.slice(11).map(r => r[1]),
      ['Fuel & Gas', 'Food & Crew', 'Office & Tech', 'Tools & Supplies', 'Extra Costs & Misc']
    );

    // Verify ONE_OF_RANGE validation expanded from $B$12 to $B$16 on both Transactions and Contracts
    assert.equal(state.txValidation.condition.values[0].userEnteredValue, '=Lists!$B$2:$B$16');
    assert.equal(state.contractsValidation.condition.values[0].userEnteredValue, '=Lists!$B$2:$B$16');

    // Verify Transactions non-overhead row and misc row were left untouched
    assert.equal(state.transactions[5][4], 'Extra Costs & Misc');
    assert.equal(state.transactions[6][4], 'Electrical & Lighting');

    // Verify Dashboard got the 4 new rows before Extra Costs & Misc
    assert.deepEqual(
      state.dashboardRows.slice(1).map(r => r[0]),
      ['Monthly Utility Bills', 'Dumpsters & Cleaning', 'Fuel & Gas', 'Food & Crew', 'Office & Tech', 'Tools & Supplies', 'Extra Costs & Misc']
    );

    // Second run must be a 100% idempotent no-op
    recordedBatchUpdates.length = 0;
    recordedValueUpdates.length = 0;

    const second = await upgradeOverheadPhasesInSheet('tok', 'sheet_lot3', mockFetch);
    assert.deepEqual(second, { addedPhases: [], reclassified: [], updatedValidations: 0 });
    assert.equal(recordedBatchUpdates.length, 0);
    assert.equal(recordedValueUpdates.length, 0);
  });

  test('expands per-row category-specific validations (e.g. row 2 Paperwork vs rows 4-8 Overhead) and namedRanges', async () => {
    const rowValidations = [
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$A$2:$A$2' }] }, strict: true, showCustomUi: true }, // Row 2: Paperwork
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$A$2:$A$2' }] }, strict: true, showCustomUi: true }, // Row 3: Paperwork
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$I$2:$I$4' }] }, strict: true, showCustomUi: true }, // Row 4: Best Buy (Overhead)
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$A$2:$A$2' }] }, strict: true, showCustomUi: true }, // Row 5: Trevino (Paperwork)
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$I$2:$I$4' }] }, strict: true, showCustomUi: true }, // Row 6: Mint Mobile
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$I$2:$I$4' }] }, strict: true, showCustomUi: true }, // Row 7: Exxon
      { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$I$2:$I$4' }] }, strict: true, showCustomUi: true }  // Row 8: Google LLC
    ];
    let namedRangeEndRow = 4;

    const listsRows = [
      ['Paperwork & Permits', '', '', '', '', '', '', '', 'Project Overhead & Bills'],
      ['Paperwork & Permits', '', '', '', '', '', '', '', 'Monthly Utility Bills'],
      ['', '', '', '', '', '', '', '', 'Dumpsters & Cleaning'],
      ['', '', '', '', '', '', '', '', 'Fuel & Gas'],
      ['', '', '', '', '', '', '', '', 'Food & Crew'],
      ['', '', '', '', '', '', '', '', 'Office & Tech'],
      ['', '', '', '', '', '', '', '', 'Tools & Supplies'],
      ['', '', '', '', '', '', '', '', 'Extra Costs & Misc']
    ];

    const mockFetch = async (url, options = {}) => {
      const decoded = decodeURIComponent(String(url));
      const method = options.method || 'GET';

      if (method === 'GET' && decoded.includes('fields=namedRanges,sheets')) {
        return {
          ok: true,
          json: async () => ({
            namedRanges: [{
              namedRangeId: 'nr_overhead',
              name: 'Project_Overhead_Bills',
              range: { sheetId: 5, startRowIndex: 1, endRowIndex: namedRangeEndRow, startColumnIndex: 8, endColumnIndex: 9 }
            }],
            sheets: [
              { properties: { sheetId: 2, title: 'Project Info', gridProperties: { rowCount: 50, columnCount: 5 } } },
              { properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 500, columnCount: 10 } } },
              { properties: { sheetId: 5, title: 'Lists', gridProperties: { rowCount: 50, columnCount: 10 } } }
            ]
          })
        };
      }
      if (method === 'GET' && decoded.includes("'Lists'!A1:Z100")) {
        return { ok: true, json: async () => ({ values: listsRows }) };
      }
      if (method === 'GET' && decoded.includes('dataValidation')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [{
              properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 500 } },
              data: [{
                rowData: rowValidations.map(rule => ({ values: [{}, { dataValidation: rule }] }))
              }]
            }]
          })
        };
      }
      if (method === 'GET' && decoded.includes('Transactions!A1:J')) {
        return { ok: true, json: async () => ({ values: [['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check', 'Receipt', 'Receipt ID']] }) };
      }
      if (method === 'POST' && decoded.includes(':batchUpdate')) {
        const body = JSON.parse(options.body);
        for (const req of body.requests) {
          if (req.updateNamedRange) {
            namedRangeEndRow = req.updateNamedRange.namedRange.range.endRowIndex;
          } else if (req.setDataValidation) {
            const { startRowIndex, endRowIndex } = req.setDataValidation.range;
            for (let r = startRowIndex; r < endRowIndex && (r - 1) < rowValidations.length; r++) {
              rowValidations[r - 1] = req.setDataValidation.rule;
            }
          }
        }
        return { ok: true, json: async () => ({}) };
      }
      throw new Error(`Unexpected: ${method} ${decoded}`);
    };

    const res = await upgradeOverheadPhasesInSheet('tok', 'sheet_lot3', mockFetch);
    assert.equal(res.updatedValidations, 3); // 1 namedRange + row 4 + rows 6..8
    assert.equal(namedRangeEndRow, 8);
    assert.equal(rowValidations[0].condition.values[0].userEnteredValue, '=Lists!$A$2:$A$2'); // Paperwork untouched
    assert.equal(rowValidations[2].condition.values[0].userEnteredValue, '=Lists!$I$2:$I$8'); // Row 4 Best Buy fixed!
    assert.equal(rowValidations[3].condition.values[0].userEnteredValue, '=Lists!$A$2:$A$2'); // Row 5 Trevino untouched
    assert.equal(rowValidations[4].condition.values[0].userEnteredValue, '=Lists!$I$2:$I$8'); // Row 6 Mint Mobile fixed!
    assert.equal(rowValidations[5].condition.values[0].userEnteredValue, '=Lists!$I$2:$I$8'); // Row 7 Exxon fixed!
    assert.equal(rowValidations[6].condition.values[0].userEnteredValue, '=Lists!$I$2:$I$8'); // Row 8 Google LLC fixed!
  });

  test('repairs paired Category-Phase Lists table, TRANSPOSE(FILTER(...)) formulas, and 6-col horizontal per-row validations', async () => {
    // Simulates Lot 3 after Run #1 where Lists!B already got the 5 overhead rows, Lists!A was left blank on the 4 new rows,
    // Lists!D2:D8 have =TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D2)), and Transactions!E2:E8 use 6-col =Lists!$D2:$I2
    const state = {
      listsColCount: 9, // A..I (needs column J appended for 7th phase!)
      lists: [
        ['Category', 'Phase', '', 'Row Helper'],
        ['Paperwork & Permits', 'Paperwork & Permits', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D2)))'],
        ['Project Overhead & Bills', 'Monthly Utility Bills', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D3)))'],
        ['Project Overhead & Bills', 'Dumpsters & Cleaning', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D4)))'],
        ['Project Overhead & Bills', 'Fuel & Gas', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D5)))'],
        ['', 'Food & Crew', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D6)))'],
        ['', 'Office & Tech', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D7)))'],
        ['', 'Tools & Supplies', '', '=IFERROR(TRANSPOSE(FILTER($B$2:$B$5, $A$2:$A$5=Transactions!D8)))'],
        ['', 'Extra Costs & Misc', '', '']
      ],
      rowValidations: Array.from({ length: 7 }, (_, idx) => ({
        condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=Lists!$D${idx + 2}:$I${idx + 2}` }] },
        strict: true,
        showCustomUi: true
      }))
    };

    const recordedBatchUpdates = [];
    const recordedValueUpdates = [];

    const mockFetch = async (url, options = {}) => {
      const decoded = decodeURIComponent(String(url));
      const method = options.method || 'GET';

      if (method === 'GET' && decoded.includes('gridProperties(rowCount,columnCount)')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [
              { properties: { sheetId: 2, title: 'Project Info', gridProperties: { rowCount: 50, columnCount: 5 } } },
              { properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 500, columnCount: 10 } } },
              { properties: { sheetId: 5, title: 'Lists', gridProperties: { rowCount: 50, columnCount: state.listsColCount } } }
            ]
          })
        };
      }
      if (method === 'GET' && decoded.includes("'Lists'!A1:Z100")) {
        return { ok: true, json: async () => ({ values: state.lists }) };
      }
      if (method === 'GET' && decoded.includes('dataValidation')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [{
              properties: { sheetId: 3, title: 'Transactions', gridProperties: { rowCount: 500 } },
              data: [{
                rowData: state.rowValidations.map(rule => ({ values: [{}, { dataValidation: rule }] }))
              }]
            }]
          })
        };
      }
      if (method === 'GET' && decoded.includes('Transactions!A1:J')) {
        return {
          ok: true,
          json: async () => ({
            values: [
              ['Date', 'Payee', 'Description', 'Category', 'Phase', 'Material', 'Labor', 'Check', 'Receipt', 'Receipt ID'],
              ['2026-11-26', 'Google LLC', 'Google AI Pro (5 TB) subscription', 'Project Overhead & Bills', 'Office & Tech', 106.59, '', 'Credit Card', '', 'r_1']
            ]
          })
        };
      }
      if (method === 'POST' && decoded.includes('/values:batchUpdate')) {
        const body = JSON.parse(options.body);
        recordedValueUpdates.push(body);
        for (const item of body.data) {
          const m = item.range.match(/^'Lists'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
          if (m) {
            const colIdx = m[1].charCodeAt(0) - 65;
            const startRow = Number(m[2]) - 1;
            item.values.forEach((val, idx) => {
              state.lists[startRow + idx][colIdx] = val[0];
            });
          }
        }
        return { ok: true, json: async () => ({}) };
      }
      if (method === 'POST' && decoded.includes(':batchUpdate')) {
        const body = JSON.parse(options.body);
        recordedBatchUpdates.push(body);
        const replies = [];
        for (const req of body.requests) {
          if (req.appendDimension && req.appendDimension.sheetId === 5 && req.appendDimension.dimension === 'COLUMNS') {
            state.listsColCount += req.appendDimension.length;
            replies.push({});
          } else if (req.findReplace && req.findReplace.sheetId === 5) {
            const re = new RegExp(req.findReplace.find, 'i');
            let count = 0;
            state.lists = state.lists.map(row =>
              row.map(cell => {
                if (typeof cell === 'string' && cell.startsWith('=') && re.test(cell)) {
                  count++;
                  return cell.replace(new RegExp(req.findReplace.find, 'gi'), req.findReplace.replacement);
                }
                return cell;
              })
            );
            replies.push({ findReplace: { occurrencesChanged: count } });
          } else if (req.setDataValidation && req.setDataValidation.range.sheetId === 3) {
            const baseFormula = req.setDataValidation.rule.condition.values[0].userEnteredValue;
            state.rowValidations = state.rowValidations.map((_, idx) => ({
              ...req.setDataValidation.rule,
              condition: {
                ...req.setDataValidation.rule.condition,
                values: [{ userEnteredValue: baseFormula.replace(/2/g, String(idx + 2)) }]
              }
            }));
            replies.push({});
          } else {
            replies.push({});
          }
        }
        return { ok: true, json: async () => ({ replies }) };
      }
      throw new Error(`Unexpected: ${method} ${decoded}`);
    };

    const repairResult = await upgradeOverheadPhasesInSheet('tok', 'sheet_lot3', mockFetch);
    assert.ok(repairResult.updatedValidations > 0);
    // All 7 overhead rows in Lists!A3:A9 now have "Project Overhead & Bills"
    assert.deepEqual(
      state.lists.slice(2, 9).map(r => r[0]),
      Array.from({ length: 7 }, () => 'Project Overhead & Bills')
    );
    // Helper formulas expanded from $B$2:$B$5 / $A$2:$A$5 to $B$2:$B$9 / $A$2:$A$9
    assert.equal(state.lists[7][3], '=IFERROR(TRANSPOSE(FILTER($B$2:$B$9, $A$2:$A$9=Transactions!D8)))');
    // Lists column count expanded from 9 (A..I) to 10 (A..J) and validations expanded to $D..:$J..
    assert.equal(state.listsColCount, 10);
    assert.equal(state.rowValidations[6].condition.values[0].userEnteredValue, '=Lists!$D8:$J8');

    // Subsequent run is a 100% idempotent no-op
    recordedBatchUpdates.length = 0;
    recordedValueUpdates.length = 0;
    const secondRun = await upgradeOverheadPhasesInSheet('tok', 'sheet_lot3', mockFetch);
    assert.deepEqual(secondRun, { addedPhases: [], reclassified: [], updatedValidations: 0 });
    assert.equal(recordedBatchUpdates.length, 0);
    assert.equal(recordedValueUpdates.length, 0);
  });
});
