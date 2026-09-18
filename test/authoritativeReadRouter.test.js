import assert from 'node:assert/strict';
import test from 'node:test';

import { getAuthoritativeReadRoute } from '../src/services/builderBrainService.js';

test('routes purchasing questions to the live Firestore checklist', () => {
  const route = getAuthoritativeReadRoute('What quartz hardware do we still need?');
  assert.equal(route.toolName, 'get_purchasing_list');
  assert.equal(route.args.trade, 'quartz');
});

test('routes financial questions to the Google Sheets ledger', () => {
  const route = getAuthoritativeReadRoute('What do we owe the electrician?');
  assert.equal(route.toolName, 'get_subcontractor_balance');
  assert.equal(route.args.tradeOrContractor, 'electrician');
});

test('does not intercept state-changing commands', () => {
  assert.equal(getAuthoritativeReadRoute('Mark the faucets as purchased'), null);
});
