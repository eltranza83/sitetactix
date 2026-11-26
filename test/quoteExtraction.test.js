import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { QUOTE_EXTRACTION_PROMPT, QUOTE_RESPONSE_SCHEMA } from '../api/_lib/quote-prompt.js';
import { resolveAlbumCategoryKey } from '../src/services/blueprintDrive.js';
import { TRADE_SECTIONS_CONFIG } from '../src/services/editFormHelpers.js';

describe('quote extraction prompt & schema + X-Ray album key resolution', () => {
  test('QUOTE_EXTRACTION_PROMPT enforces builder self-identity rule and all 30 phases', () => {
    assert.match(QUOTE_EXTRACTION_PROMPT, /NEVER extract ADEPEC/i);
    assert.match(QUOTE_EXTRACTION_PROMPT, /Fuel & Gas/);
    assert.match(QUOTE_EXTRACTION_PROMPT, /Plumbing Rough-In/);
    assert.equal(QUOTE_RESPONSE_SCHEMA.properties.items.items.properties.tradePhase.enum.length, 30);
  });

  test('resolveAlbumCategoryKey maps Dashboard category display names to TRADE_SECTIONS_CONFIG keys', () => {
    assert.equal(
      resolveAlbumCategoryKey(TRADE_SECTIONS_CONFIG, 'Paperwork & Permits'),
      'Paperwork_&_Permits'
    );
    assert.equal(
      resolveAlbumCategoryKey(TRADE_SECTIONS_CONFIG, 'Paint & Tile'),
      'Paint_Tile'
    );
    assert.equal(
      resolveAlbumCategoryKey(TRADE_SECTIONS_CONFIG, 'Project Overhead & Bills'),
      'Project_Overhead_&_Bills'
    );
  });
});
