import assert from 'node:assert/strict';
import test from 'node:test';

import { askGeminiBrain, getAuthoritativeReadRoute } from '../src/services/builderBrainService.js';

test('routes purchasing questions to the live Firestore checklist', () => {
  const route = getAuthoritativeReadRoute('What quartz hardware do we still need?');
  assert.equal(route.toolName, 'get_purchasing_list');
  assert.equal(route.args.trade, 'quartz');
});

test('leaves financial questions on Jarvis\'s existing dashboard reasoning path', () => {
  assert.equal(getAuthoritativeReadRoute('What do we owe the electrician?'), null);
  assert.equal(getAuthoritativeReadRoute('Do we owe the painter?'), null);
  assert.equal(getAuthoritativeReadRoute('What is the electrical balance?'), null);
  assert.equal(getAuthoritativeReadRoute('Who do we owe money to?'), null);
});

test('does not intercept state-changing commands', () => {
  assert.equal(getAuthoritativeReadRoute('Mark the faucets as purchased'), null);
});

test('finance questions pass the loaded spreadsheet rows to the original Jarvis flow', async () => {
  const dashboard = {
    projectInfo: { totalSpent: '$3,000.00' },
    subcontractors: [
      { phase: 'Electrical & Lighting', payee: 'Bright Current LLC', originalQuote: '$8,000.00', totalSpent: '$3,000.00', remainingBalance: '$5,000.00' },
      { phase: 'Paint & Finishes', payee: 'Color Craft LLC', originalQuote: '$2,000.00', totalSpent: '$2,000.00', remainingBalance: '$0.00' }
    ]
  };
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) !== '/api/ask-brain') return Response.json({ documents: [] });
    const request = JSON.parse(options.body);
    seen.push(request);
    return Response.json({ text: 'According to your project spreadsheet, the electrical balance is $5,000.' });
  };

  try {
    const response = await askGeminiBrain('Do we owe the electrician?', [], 'Lot 3', '', dashboard, 'lot_3', [], null, null, false, null, { skipAuthGate: true });
    assert.match(response.text, /\$5,000/);
    assert.equal(seen.length, 1, 'Finance should not be pre-empted by the direct lookup gate');
    assert.match(seen[0].systemInstruction, /Electrical & Lighting/);
    assert.match(seen[0].systemInstruction, /Paint & Finishes/);
    assert.match(seen[0].systemInstruction, /Remaining Balance: \$5,000\.00/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
