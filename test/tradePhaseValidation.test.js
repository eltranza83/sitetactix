import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADE_SECTIONS_CONFIG,
  isValidPhase,
  isDraftPhaseValid
} from '../src/services/editFormHelpers.js';
import { GEMINI_RESPONSE_SCHEMA, DOCUMENT_EXTRACTION_PROMPT } from '../api/_lib/document-prompt.js';
import { generateDocumentData } from '../api/extract-document.js';

test('1. TRADE_SECTIONS_CONFIG contains exactly 9 categories and 26 canonical phases', () => {
  const categories = Object.keys(TRADE_SECTIONS_CONFIG);
  assert.equal(categories.length, 9);

  const allPhases = categories.flatMap(cat => TRADE_SECTIONS_CONFIG[cat].phases);
  assert.equal(allPhases.length, 26);

  // Assert schema enum contains all 26 phases
  assert.equal(GEMINI_RESPONSE_SCHEMA.properties.tradePhase.type, 'STRING');
  assert.equal(Array.isArray(GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum), true);
  assert.equal(GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum.length, 26);
  assert.deepEqual([...GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum].sort(), [...allPhases].sort());
});

test('2. isValidPhase returns true for valid category-phase pairs and false for mismatched/invented phases', () => {
  // Valid pairs
  assert.equal(isValidPhase('Mechanicals_&_Utilities', 'Plumbing Rough-In'), true);
  assert.equal(isValidPhase('Mechanicals_&_Utilities', 'Electrical & Lighting'), true);
  assert.equal(isValidPhase('Framing_&_Lumber', 'Framing Lumber & Truss'), true);
  assert.equal(isValidPhase('House_Exterior_&_Yard', 'Fencing & Gates'), true);

  // Combined / invented names (the real bug)
  assert.equal(isValidPhase('Mechanicals_&_Utilities', 'Plumbing Rough-In and Electrical'), false);
  assert.equal(isValidPhase('Mechanicals_&_Utilities', 'Plumbing & Electrical Rough-In'), false);

  // Valid phase from a DIFFERENT category (cross-category mismatch)
  assert.equal(isValidPhase('Mechanicals_&_Utilities', 'Plumbing Hardware Fixtures'), false);
  assert.equal(isValidPhase('Interior_Hardware', 'Plumbing Rough-In'), false);

  // Missing or empty values
  assert.equal(isValidPhase(null, 'Plumbing Rough-In'), false);
  assert.equal(isValidPhase('Mechanicals_&_Utilities', null), false);
  assert.equal(isValidPhase('', ''), false);
});

test('3. isDraftPhaseValid validates single-phase drafts accurately', () => {
  assert.equal(isDraftPhaseValid({
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In'
  }), true);

  assert.equal(isDraftPhaseValid({
    tradeCategory: 'Mechanicals_&_Utilities',
    tradePhase: 'Plumbing Rough-In and Electrical'
  }), false);

  assert.equal(isDraftPhaseValid(null), false);
});

test('4. isDraftPhaseValid validates every split in a split draft', () => {
  // All splits valid
  const validSplitDraft = {
    splits: [
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Electrical & Lighting' }
    ]
  };
  assert.equal(isDraftPhaseValid(validSplitDraft), true);

  // One split with invalid combined phase
  const invalidSplitDraft = {
    splits: [
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing & Electrical' }
    ]
  };
  assert.equal(isDraftPhaseValid(invalidSplitDraft), false);

  // One split with cross-category mismatch
  const mismatchedSplitDraft = {
    splits: [
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' },
      { tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Hardware Fixtures' }
    ]
  };
  assert.equal(isDraftPhaseValid(mismatchedSplitDraft), false);
});

test('5. Prompt rules explicitly forbid combined phase names and instruct choosing the largest dollar amount', () => {
  assert.match(
    DOCUMENT_EXTRACTION_PROMPT,
    /If a receipt contains items for more than one phase, choose the phase with the largest dollar amount\. Never combine phase names\./i
  );
});

test('6. generateDocumentData sets temperature: 0 in generationConfig', async () => {
  let capturedConfig = null;
  await generateDocumentData({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      capturedConfig = body.generationConfig;
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'receipt', description: 'Test', vendor: 'Home Depot', costCategory: 'material', amount: 156.60, date: '2023-10-26', tradeCategory: 'Mechanicals_&_Utilities', tradePhase: 'Plumbing Rough-In' }) }] } }]
      });
    }
  });

  assert.ok(capturedConfig);
  assert.equal(capturedConfig.temperature, 0);
  assert.equal(capturedConfig.responseMimeType, 'application/json');
});
