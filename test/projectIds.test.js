import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalProjectId } from '../src/services/projectIds.js';

test('toCanonicalProjectId normalizes lot names', () => {
  assert.equal(toCanonicalProjectId('Lot 55'), 'lot_55');
  assert.equal(toCanonicalProjectId('lot 55'), 'lot_55');
  assert.equal(toCanonicalProjectId('lot-55'), 'lot_55');
  assert.equal(toCanonicalProjectId('LOT_55'), 'lot_55');
  assert.equal(toCanonicalProjectId('Lot 3'), 'lot_3');
  assert.equal(toCanonicalProjectId('Lot 3B'), 'lot_3b');
});

test('toCanonicalProjectId slugifies other names and handles special values', () => {
  assert.equal(toCanonicalProjectId('Westlake Commercial Lot 12'), 'westlake_commercial_lot_12');
  assert.equal(toCanonicalProjectId('master'), 'master');
  assert.equal(toCanonicalProjectId('purchasing_master'), 'master');
  assert.equal(toCanonicalProjectId(''), 'default');
  assert.equal(toCanonicalProjectId(null), 'default');
  assert.equal(toCanonicalProjectId('!!!'), 'default');
});
