import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeZoomScale } from '../src/services/blueprintViewport.js';

test('normalizeZoomScale clamps floor plan zoom to supported bounds', () => {
  assert.equal(normalizeZoomScale(0.1), 1);
  assert.equal(normalizeZoomScale(1.5), 1.5);
  assert.equal(normalizeZoomScale(5), 3);
});

test('normalizeZoomScale falls back to default zoom for invalid values', () => {
  assert.equal(normalizeZoomScale('not-a-number'), 1);
  assert.equal(normalizeZoomScale(Number.NaN), 1);
});

