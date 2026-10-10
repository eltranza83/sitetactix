import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanNumberInput } from '../src/services/projectInfoFormatter.js';

test('project form number boxes drop autofilled text', () => {
  assert.equal(cleanNumberInput('United States'), '');
  assert.equal(cleanNumberInput('70500'), '70500');
  assert.equal(cleanNumberInput('$70,500.00'), '70,500.00');
  assert.equal(cleanNumberInput(' 2 600 sq ft'), '2600');
  assert.equal(cleanNumberInput(undefined), '');
});
