import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCategorySortRank,
  formatCategoryTitle
} from '../src/config/tradesConfig.js';

describe('Dashboard Trade Sections Chronological Sorting & Formatting Suite', () => {
  test('1. getCategorySortRank assigns exact chronological order', () => {
    assert.equal(getCategorySortRank('PAPERWORK & PERMITS'), 1);
    assert.equal(getCategorySortRank('SITE PREP & STRUCTURE'), 2);
    assert.equal(getCategorySortRank('FRAMING & LUMBER'), 3);
    assert.equal(getCategorySortRank('MECHANICALS & UTILITIES'), 4);
    assert.equal(getCategorySortRank('INTERIOR FINISHES'), 5);
    assert.equal(getCategorySortRank('PAINT TILE'), 6);
    assert.equal(getCategorySortRank('PAINT & TILE'), 6);
    assert.equal(getCategorySortRank('INTERIOR HARDWARE'), 7);
    assert.equal(getCategorySortRank('HOUSE EXTERIOR & YARD'), 8);
    assert.equal(getCategorySortRank('PROJECT OVERHEAD & BILLS'), 9);
    assert.equal(getCategorySortRank('CUSTOM TRADE MISC'), 99);
  });

  test('2. Real-World Screenshot Categories Sort into Exact Chronological Sequence', () => {
    const originalUnsorted = [
      { name: 'SITE PREP & STRUCTURE' },
      { name: 'FRAMING & LUMBER' },
      { name: 'MECHANICALS & UTILITIES' },
      { name: 'INTERIOR FINISHES' },
      { name: 'PAINT TILE' },
      { name: 'HOUSE EXTERIOR & YARD' },
      { name: 'PROJECT OVERHEAD & BILLS' },
      { name: 'PAPERWORK & PERMITS' },
      { name: 'INTERIOR HARDWARE' }
    ];

    const sorted = [...originalUnsorted].sort((a, b) => {
      const rankA = getCategorySortRank(a.name);
      const rankB = getCategorySortRank(b.name);
      if (rankA !== rankB) return rankA - rankB;
      return (a.name || '').localeCompare(b.name || '');
    });

    const expectedOrder = [
      'PAPERWORK & PERMITS',
      'SITE PREP & STRUCTURE',
      'FRAMING & LUMBER',
      'MECHANICALS & UTILITIES',
      'INTERIOR FINISHES',
      'PAINT TILE',
      'INTERIOR HARDWARE',
      'HOUSE EXTERIOR & YARD',
      'PROJECT OVERHEAD & BILLS'
    ];

    assert.deepEqual(sorted.map(c => c.name), expectedOrder);
  });

  test('3. formatCategoryTitle normalizes PAINT TILE to PAINT & TILE', () => {
    assert.equal(formatCategoryTitle('PAINT TILE'), 'PAINT & TILE');
    assert.equal(formatCategoryTitle('paint tile'), 'PAINT & TILE');
    assert.equal(formatCategoryTitle('FRAMING & LUMBER'), 'FRAMING & LUMBER');
    assert.equal(formatCategoryTitle('SITE PREP & STRUCTURE'), 'SITE PREP & STRUCTURE');
  });
});
