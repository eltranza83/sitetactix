import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuoteFileName,
  findDuplicateContractMatches,
  matchQuoteFilesForSub,
  saveQuoteContractsToSheet,
  updateContractRowInSheet
} from '../src/services/contractsService.js';

describe('contractsService', () => {
  test('buildQuoteFileName sanitizes sub/company and preserves extension', () => {
    const name = buildQuoteFileName({
      file: { name: 'Stucco Proposal: Lot#3.pdf', type: 'application/pdf' },
      sub: 'Enrique Vallejo',
      company: 'Lucen LLC',
      date: '2026-11-26'
    });
    assert.equal(name, 'Quote - Lucen LLC - 2026-11-26 - Stucco Proposal_ Lot#3.pdf');
  });

  test('findDuplicateContractMatches matches by canonical phase and either sub or company', () => {
    const existing = [
      { rowNumber: 2, sub: 'Enrique Vallejo', company: 'Lucen LLC', category: 'Mechanicals & Utilities', phase: 'Electrical & Lighting', quote: 12000 }
    ];
    const matches = findDuplicateContractMatches(
      existing,
      [
        { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting', quoteAmount: 1500 },
        { tradeCategory: 'Interior_Hardware', tradePhase: 'Electrical Hardware Fixtures', quoteAmount: 900 }
      ],
      { sub: '', company: 'lucen llc' }
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].oldQuote, 12000);
    assert.equal(matches[0].newQuote, 1500);
    assert.equal(matches[0].combinedQuote, 13500);
  });

  test('saveQuoteContractsToSheet writes strictly to Contracts!A:E, skipping F:G formula columns, and supports replace & add_to_quote', async () => {
    const state = {
      rows: [
        ['Sub', 'Company', 'Category', 'Phase', 'Quote'],
        ['Enrique Vallejo', 'Lucen LLC', 'Mechanicals & Utilities', 'Electrical & Lighting', 12000],
        ['', '', '', '', ''] // Row 3 is empty in A:E even if F3:G3 have formulas in the Sheet
      ]
    };
    const recordedRanges = [];

    const mockFetch = async (url, options = {}) => {
      const decoded = decodeURIComponent(String(url));
      const method = options.method || 'GET';

      if (method === 'GET' && decoded.includes('fields=sheets')) {
        return {
          ok: true,
          json: async () => ({
            sheets: [
              { properties: { sheetId: 1, title: 'Project Info', gridProperties: { rowCount: 20, columnCount: 5 } } },
              { properties: { sheetId: 2, title: 'Transactions', gridProperties: { rowCount: 500, columnCount: 10 } } },
              { properties: { sheetId: 3, title: 'Contracts', gridProperties: { rowCount: 100, columnCount: 7 } } }
            ]
          })
        };
      }
      if (method === 'GET' && decoded.includes('Contracts!A1:E')) {
        return { ok: true, json: async () => ({ values: state.rows }) };
      }
      if (method === 'POST' && decoded.includes('/values:batchUpdate')) {
        const body = JSON.parse(options.body);
        for (const item of body.data) {
          recordedRanges.push(item.range);
          const m = item.range.match(/^Contracts!A(\d+):E(\d+)$/);
          assert.ok(m, `Expected Contracts!A{r}:E{r}, got ${item.range}`);
          const rowIdx = Number(m[1]) - 1;
          while (state.rows.length <= rowIdx) state.rows.push(['', '', '', '', '']);
          state.rows[rowIdx] = item.values[0];
        }
        return { ok: true, json: async () => ({}) };
      }
      throw new Error(`Unexpected request: ${method} ${decoded}`);
    };

    // 1. Append a brand-new multi-phase quote into rows 3 and 4
    await saveQuoteContractsToSheet({
      accessToken: 'tok',
      spreadsheetId: 'sheet_1',
      sub: 'Pedro Salinas',
      company: 'Salinas Plumbing',
      items: [
        { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In', quoteAmount: 8500 },
        { tradeCategory: 'Interior_Hardware', tradePhase: 'Plumbing Hardware Fixtures', quoteAmount: 2400 }
      ],
      conflictResolution: 'append_row',
      fetchImpl: mockFetch
    });

    assert.deepEqual(recordedRanges, ['Contracts!A3:E3', 'Contracts!A4:E4']);
    assert.deepEqual(state.rows[2], ['Pedro Salinas', 'Salinas Plumbing', 'Mechanicals & Utilities', 'Plumbing Rough-In', 8500]);
    assert.deepEqual(state.rows[3], ['Pedro Salinas', 'Salinas Plumbing', 'Interior Hardware', 'Plumbing Hardware Fixtures', 2400]);

    // 2. Add to quote (Change Order) on Enrique's Electrical row 2
    await saveQuoteContractsToSheet({
      accessToken: 'tok',
      spreadsheetId: 'sheet_1',
      sub: 'Enrique Vallejo',
      company: 'Lucen LLC',
      items: [{ tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting', quoteAmount: 1800 }],
      conflictResolution: 'add_to_quote',
      fetchImpl: mockFetch
    });
    assert.equal(state.rows[1][4], 13800);

    // 3. Replace quote on Enrique's Electrical row 2
    await saveQuoteContractsToSheet({
      accessToken: 'tok',
      spreadsheetId: 'sheet_1',
      sub: 'Enrique Vallejo',
      company: 'Lucen LLC',
      items: [{ tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting', quoteAmount: 15000 }],
      conflictResolution: 'replace',
      fetchImpl: mockFetch
    });
    assert.equal(state.rows[1][4], 15000);
  });

  test('buildQuoteFileName supports Change Order prefix', () => {
    const name = buildQuoteFileName({
      file: { name: 'Extra_Footings.pdf', type: 'application/pdf' },
      sub: 'Ramiro Garza',
      company: 'RG Concrete',
      date: '2026-11-27',
      prefix: 'Change Order'
    });
    assert.equal(name, 'Change Order - RG Concrete - 2026-11-27 - Extra_Footings.pdf');
  });

  test('matchQuoteFilesForSub matches Drive files in Contracts & Quotes without extra Sheet columns', () => {
    const files = [
      { id: 'f1', name: 'Quote - RG Concrete - 2026-09-10 - slab.pdf', modifiedTime: '2026-09-10T10:00:00Z' },
      { id: 'f2', name: 'Change Order - RG Concrete - 2026-10-01 - patio.pdf', modifiedTime: '2026-10-01T10:00:00Z' },
      { id: 'f3', name: 'Quote - Salinas Plumbing - 2026-09-12 - roughin.pdf', modifiedTime: '2026-09-12T10:00:00Z' }
    ];

    const matched = matchQuoteFilesForSub(files, {
      payee: 'Ramiro Garza (RG Concrete)',
      contracts: [{ sub: 'Ramiro Garza', company: 'RG Concrete' }]
    });

    assert.deepEqual(matched.map(f => f.id), ['f2', 'f1']);
  });

  test('updateContractRowInSheet writes strictly to Contracts!A{row}:E{row}', async () => {
    let capturedUrl = '';
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedUrl = decodeURIComponent(url);
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) };
    };

    const res = await updateContractRowInSheet({
      accessToken: 'tok',
      spreadsheetId: 'sheet_1',
      rowNumber: 4,
      sub: 'Ramiro Garza',
      company: 'RG Concrete',
      tradeCategory: 'Site_Prep_&_Structure',
      tradePhase: 'Foundation & Flatwork',
      quoteAmount: 29500,
      fetchImpl: mockFetch
    });

    assert.match(capturedUrl, /Contracts!A4:E4/);
    assert.deepEqual(capturedBody.values, [['Ramiro Garza', 'RG Concrete', 'Site Prep & Structure', 'Foundation & Flatwork', 29500]]);
    assert.equal(res.rowNumber, 4);
  });
});
