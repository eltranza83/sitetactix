import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeV2Dashboard, contractDisplayName } from '../src/services/sheetV2.js';
import { filterContractorSuggestions } from '../src/services/dashboardDrive.js';

describe('contractor names on the Dashboard', () => {
  test('person and company shown together only when both exist and differ', () => {
    assert.equal(contractDisplayName('Enrique Vallejo', 'Lucen LLC'), 'Enrique Vallejo (Lucen LLC)');
    assert.equal(contractDisplayName('Rio Cool Air', 'Rio Cool Air'), 'Rio Cool Air');
    assert.equal(contractDisplayName('Rio Cool Air', 'RIO COOL AIR '), 'Rio Cool Air');
    assert.equal(contractDisplayName('Pedro Salinas', ''), 'Pedro Salinas');
    assert.equal(contractDisplayName('', 'Lucen LLC'), 'Lucen LLC');
    assert.equal(contractDisplayName('', ''), '');
  });

  const data = computeV2Dashboard({
    projectInfoRows: [],
    transactionRows: [
      ['Date'],
      ['2026-09-01', 'Lucen LLC', 'Draw', 'Mechanicals & Utilities', 'Electrical & Lighting', '', 3000, '1001', '', 'r1']
    ],
    contractRows: [
      ['Sub'],
      ['Enrique Vallejo', 'Lucen LLC', 'Mechanicals & Utilities', 'Electrical & Lighting', 15000],
      ['Pedro Salinas', '', 'Paint & Tile', 'Tile & Flooring', 9500]
    ]
  });
  const electrical = data.subcontractors.find(s => s.phase === 'Electrical & Lighting');

  test('phase rows and the lookup card use the combined name; payment lines keep the check name', () => {
    assert.equal(electrical.payee, 'Enrique Vallejo (Lucen LLC)');
    assert.equal(data.contracts[0].displayName, 'Enrique Vallejo (Lucen LLC)');
    assert.equal(electrical.payments[0].vendor, 'Lucen LLC');
    assert.equal(electrical.contractorPaid, 3000);
  });

  test('lookup finds the contract by the person or the company name', () => {
    for (const query of ['Enrique', 'lucen', 'Vallejo', 'LUCEN LLC']) {
      const found = filterContractorSuggestions(data.subcontractors, query);
      assert.ok(found.some(s => s.phase === 'Electrical & Lighting'), query);
    }
    assert.ok(filterContractorSuggestions(data.subcontractors, 'Pedro').some(s => s.phase === 'Tile & Flooring'));
    assert.equal(filterContractorSuggestions(data.subcontractors, 'Nobody Here').length, 0);
  });

  test('old-layout entries (no contracts list) are still searched by payee, phase and category', () => {
    const old = [{ payee: 'Garza Roofing', phase: 'Roofing', category: 'Site Prep & Structure' }, null];
    assert.equal(filterContractorSuggestions(old, 'garza').length, 1);
    assert.equal(filterContractorSuggestions(old, 'site prep').length, 1);
    assert.deepEqual(filterContractorSuggestions(undefined, 'x'), []);
  });
});
