import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TRADE_CATEGORIES, ALL_PHASES, categoryRank } from '../src/config/tradeCategories.js';
import { V2_CATEGORIES } from '../src/services/sheetV2.js';
import { TRADE_SECTIONS_CONFIG } from '../src/services/editFormHelpers.js';
import { GEMINI_RESPONSE_SCHEMA, DOCUMENT_EXTRACTION_PROMPT } from '../api/_lib/document-prompt.js';

describe('shared category and phase list', () => {
  test('has 9 categories and 30 unique phases', () => {
    assert.equal(TRADE_CATEGORIES.length, 9);
    assert.equal(ALL_PHASES.length, 30);
    assert.equal(new Set(ALL_PHASES).size, 30);
  });

  test('the Sheet code, Edit screen and scan AI all use the same list', () => {
    assert.deepEqual(V2_CATEGORIES.map(c => [c.key, c.name, c.phases]), TRADE_CATEGORIES.map(c => [c.key, c.name, c.phases]));
    assert.deepEqual(Object.keys(TRADE_SECTIONS_CONFIG), TRADE_CATEGORIES.map(c => c.key));
    TRADE_CATEGORIES.forEach(c => {
      assert.ok(c.color && c.color.startsWith('#'), `${c.key} has a color`);
      assert.equal(TRADE_SECTIONS_CONFIG[c.key].color, c.color);
    });
    assert.deepEqual(GEMINI_RESPONSE_SCHEMA.properties.tradeCategory.enum, TRADE_CATEGORIES.map(c => c.key));
    assert.deepEqual(GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum, ALL_PHASES);
    TRADE_CATEGORIES.forEach(c => assert.ok(DOCUMENT_EXTRACTION_PROMPT.includes(`- ${c.key}: ${c.phases.join('; ')}`), c.key));
  });


  test('categories sort in Sheet order by name or key; unknown names last', () => {
    assert.equal(categoryRank('Paperwork & Permits'), 0);
    assert.equal(categoryRank('PAINT & TILE'), 5);
    assert.equal(categoryRank('Project_Overhead_&_Bills'), 8);
    assert.equal(categoryRank('Custom Trade'), 99);
  });

});

describe('scan rules for rough-in vs fixtures', () => {
  test('the scan AI gets the owner\'s electrical and plumbing fixture rules', () => {
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Electrical Hardware Fixtures = [^\n]*switches[^\n]*chandeliers/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Electrical & Lighting = [^\n]*wire[^\n]*conduit/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Plumbing Rough-In = [^\n]*shower valves/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Plumbing Hardware Fixtures = [^\n]*faucets[^\n]*water heater/);
  });

  test('the scan AI gets the owner\'s Paperwork vs Project Overhead rules', () => {
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Paperwork vs Project Overhead/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Paperwork & Permits = [^\n]*building permits[^\n]*Never put office supplies/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Fuel & Gas = [^\n]*gasoline[^\n]*diesel/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Food & Crew = [^\n]*crew meals[^\n]*Gatorade/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Office & Tech = [^\n]*printer ink[^\n]*subscriptions[^\n]*SIM plans/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Tools & Supplies = [^\n]*saw blades[^\n]*extension cords/);
    assert.match(DOCUMENT_EXTRACTION_PROMPT, /Extra Costs & Misc = [^\n]*do not fit any phase above/);
  });
});
