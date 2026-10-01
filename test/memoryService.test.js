import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveMemory,
  getMemories,
  updateMemory,
  deactivateMemory,
  hardDeleteMemory,
  searchMemories,
  detectAmbiguity,
  extractTags,
  sanitizeMemoryRecord,
  formatMemoriesForPrompt,
  MEMORY_STORAGE_KEY
} from '../src/services/memoryService.js';

// Setup mock localStorage in Node test environment
if (typeof globalThis.localStorage === 'undefined') {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

describe('SiteTactix Second Brain — Persistent Memory Service Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('Test 1 — Save Memory: Correctly sanitizes schema with all required & audit fields', async () => {
    const saved = await saveMemory({
      text: 'Painter for Lot 12 prefers ACH payments.',
      projectId: 'Lot 12',
      category: 'subcontractor',
      memoryType: 'subcontractor',
      importance: 'important',
      effectiveDate: '2026-08-01',
      source: 'user_explicit'
    });

    assert.ok(saved.id.startsWith('mem_'), 'Memory ID should be generated');
    assert.equal(saved.text, 'Painter for Lot 12 prefers ACH payments.');
    assert.equal(saved.projectId, 'Lot 12');
    assert.equal(saved.isGlobal, false);
    assert.equal(saved.category, 'subcontractor');
    assert.equal(saved.importance, 'important');
    assert.equal(saved.active, true);
    assert.equal(saved.effectiveDate, '2026-08-01');
    assert.equal(saved.confidence, 1.0);
    assert.ok(Array.isArray(saved.changeHistory), 'Change history should be an array');
    assert.equal(saved.changeHistory.length, 0);
  });

  test('Test 2 — Persistence: Saved memories persist and reload across sessions', async () => {
    await saveMemory({
      text: 'Tile in Master Bathroom is Cascading Waters 12x24',
      projectId: 'Lot 12',
      category: 'decision'
    });

    // Verify stored in localStorage cache
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    assert.ok(raw, 'Raw storage key must exist');

    // Reload from storage
    const loaded = await getMemories({ projectId: 'Lot 12' });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].text, 'Tile in Master Bathroom is Cascading Waters 12x24');
  });

  test('Test 3 — Update & Change History: Maintains full audit trail of prior values and reasons', async () => {
    const original = await saveMemory({
      text: 'Painter prefers payment by check.',
      projectId: 'Lot 12',
      category: 'subcontractor'
    });

    const updated = await updateMemory(
      original.id,
      { text: 'Painter prefers ACH payment directly to Chase account.' },
      'Painter changed payment method preference'
    );

    assert.equal(updated.text, 'Painter prefers ACH payment directly to Chase account.');
    assert.equal(updated.changeHistory.length, 1);
    assert.equal(updated.changeHistory[0].previousText, 'Painter prefers payment by check.');
    assert.equal(updated.changeHistory[0].reason, 'Painter changed payment method preference');
    assert.ok(updated.updatedAt > original.createdAt || updated.updatedAt === original.createdAt);
  });

  test('Test 4 — Forget / Deactivate: Soft deletes memory and excludes from standard active queries', async () => {
    const mem = await saveMemory({
      text: 'Old framing layout note to be disregarded',
      projectId: 'Lot 12'
    });

    const deactivated = await deactivateMemory(mem.id, 'No longer applicable');
    assert.equal(deactivated.active, false);
    assert.ok(deactivated.deletedAt);

    // Active-only fetch should exclude deactivated item
    const activeList = await getMemories({ projectId: 'Lot 12', activeOnly: true });
    assert.equal(activeList.length, 0);

    // All fetch should include it
    const allList = await getMemories({ projectId: 'Lot 12', activeOnly: false });
    assert.equal(allList.length, 1);
    assert.equal(allList[0].active, false);
  });

  test('Test 5 — Project Isolation: Scopes memories strictly by Lot/Project unless Global', async () => {
    await saveMemory({
      text: 'Lot 12 Painter prefers ACH payments.',
      projectId: 'Lot 12',
      isGlobal: false
    });

    await saveMemory({
      text: 'Lot 15 Painter prefers Paper Checks.',
      projectId: 'Lot 15',
      isGlobal: false
    });

    await saveMemory({
      text: 'Standard company dumpster provider is Waste Management.',
      projectId: null,
      isGlobal: true
    });

    // Query Lot 12: should get Lot 12 + Global, but NOT Lot 15
    const lot12Memories = await getMemories({ projectId: 'Lot 12', includeGlobal: true });
    assert.equal(lot12Memories.length, 2);
    assert.ok(lot12Memories.some(m => m.projectId === 'Lot 12'));
    assert.ok(lot12Memories.some(m => m.isGlobal === true));
    assert.ok(!lot12Memories.some(m => m.projectId === 'Lot 15'), 'Lot 15 memory must never leak into Lot 12');

    // Query Lot 15: should get Lot 15 + Global, but NOT Lot 12
    const lot15Memories = await getMemories({ projectId: 'Lot 15', includeGlobal: true });
    assert.equal(lot15Memories.length, 2);
    assert.ok(lot15Memories.some(m => m.projectId === 'Lot 15'));
    assert.ok(lot15Memories.some(m => m.isGlobal === true));
    assert.ok(!lot15Memories.some(m => m.projectId === 'Lot 12'), 'Lot 12 memory must never leak into Lot 15');
  });

  test('Test 6 — Keyword Search & Tag Matching: Finds relevant memories by intent and project scope', async () => {
    await saveMemory({
      text: 'Painter prefers ACH wire transfer payments.',
      projectId: 'Lot 12',
      tags: ['painter', 'ach', 'wire', 'transfer', 'payments']
    });

    const searchResults = await searchMemories('How does the painter like to get paid?', { projectId: 'Lot 12' });
    assert.ok(searchResults.length > 0, 'Should find matching painter memory');
    assert.equal(searchResults[0].text, 'Painter prefers ACH wire transfer payments.');
  });

  test('Test 7 — Ambiguity Detection: Flags speculative phrasing and avoids hard fact storage', () => {
    const spec1 = detectAmbiguity('The painter might switch to ACH next month.');
    assert.equal(spec1.isAmbiguous, true);
    assert.equal(spec1.indicator, 'might');

    const spec2 = detectAmbiguity('We are considering using Sherwin-Williams for exterior.');
    assert.equal(spec2.isAmbiguous, true);
    assert.equal(spec2.indicator, 'considering');

    const confirmed = detectAmbiguity('John quoted $8,500 for electrical.');
    assert.equal(confirmed.isAmbiguous, false);
  });

  test('Test 8 — Lessons Learned & Business Knowledge: Formats cleanly for prompt injection', async () => {
    const lesson = await saveMemory({
      text: 'ABC Supply usually provides 10% lower pricing on architectural shingles.',
      projectId: null,
      isGlobal: true,
      category: 'lesson_learned',
      memoryType: 'lesson_learned',
      importance: 'critical'
    });

    const formatted = formatMemoriesForPrompt([lesson]);
    assert.ok(formatted.includes('[GLOBAL BUSINESS KNOWLEDGE]'));
    assert.ok(formatted.includes('[TYPE: LESSON_LEARNED]'));
    assert.ok(formatted.includes('⚡ CRITICAL:'));
    assert.ok(formatted.includes('ABC Supply usually provides 10% lower pricing'));
  });
});
