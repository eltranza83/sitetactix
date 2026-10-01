import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadUserPreferences,
  USER_PREFERENCE_STORAGE_KEY
} from '../src/services/memoryService.js';

// Setup mock localStorage for Node.js test runner environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

test.beforeEach(() => {
  mockStorage.clear();
});

test('1. Flag set, local has A and B, cloud has A -> result is only A (no resurrection)', async () => {
  const userId = 'user_test_resurrection';
  const migrationKey = `${USER_PREFERENCE_STORAGE_KEY}_migrated_${userId}`;
  const storageKey = `${USER_PREFERENCE_STORAGE_KEY}_${userId}`;

  // Mark migration as already completed
  mockStorage.set(migrationKey, 'true');

  // Local storage has preferences A and B (e.g. B was deleted in cloud on another device)
  const localList = [
    { id: 'prefA', category: 'communication', preferenceStatement: 'Pref A statement', updatedAt: '2026-09-01T10:00:00Z' },
    { id: 'prefB', category: 'scheduling', preferenceStatement: 'Pref B statement', updatedAt: '2026-09-01T10:00:00Z' }
  ];
  mockStorage.set(storageKey, JSON.stringify(localList));

  // Cloud only has preference A
  const cloudList = [
    { id: 'prefA', category: 'communication', preferenceStatement: 'Pref A statement', updatedAt: '2026-09-01T10:00:00Z', uid: userId }
  ];

  const fakeFirestore = {
    getDocs: async () => cloudList.map(item => ({ id: item.id, data: () => item })),
    setDoc: async () => {
      assert.fail('setDoc should not be called when migration is already completed');
    }
  };

  const result = await loadUserPreferences(userId, null, { firestore: fakeFirestore });

  // Firestore is authoritative for existence: only A is returned, B is not resurrected
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'prefA');

  // Verify local storage is synced to only contain A
  const updatedLocal = JSON.parse(mockStorage.get(storageKey));
  assert.equal(updatedLocal.length, 1);
  assert.equal(updatedLocal[0].id, 'prefA');
});

test('2. Flag not set, local has A and B, cloud empty -> both get uploaded and flag is set', async () => {
  const userId = 'user_test_migration';
  const migrationKey = `${USER_PREFERENCE_STORAGE_KEY}_migrated_${userId}`;
  const storageKey = `${USER_PREFERENCE_STORAGE_KEY}_${userId}`;

  // Flag is NOT set
  assert.equal(localStorage.getItem(migrationKey), null);

  // Local storage has A and B
  const localList = [
    { id: 'prefA', category: 'communication', preferenceStatement: 'Pref A statement', updatedAt: '2026-09-01T10:00:00Z' },
    { id: 'prefB', category: 'scheduling', preferenceStatement: 'Pref B statement', updatedAt: '2026-09-01T10:00:00Z' }
  ];
  mockStorage.set(storageKey, JSON.stringify(localList));

  const uploaded = [];
  const fakeFirestore = {
    getDocs: async () => [], // Cloud empty
    setDoc: async (id, data, opts) => {
      uploaded.push({ id, data, opts });
      return Promise.resolve();
    }
  };

  const result = await loadUserPreferences(userId, null, { firestore: fakeFirestore });

  // Both should be returned
  assert.equal(result.length, 2);
  const resultIds = result.map(p => p.id).sort();
  assert.deepEqual(resultIds, ['prefA', 'prefB']);

  // Both should have been uploaded to Firestore with uid and merge: true
  assert.equal(uploaded.length, 2);
  const uploadedIds = uploaded.map(u => u.id).sort();
  assert.deepEqual(uploadedIds, ['prefA', 'prefB']);
  for (const up of uploaded) {
    assert.equal(up.data.uid, userId);
    assert.equal(up.opts.merge, true);
  }

  // Migration flag must be set to 'true'
  assert.equal(mockStorage.get(migrationKey), 'true');
});

test('3. Flag not set and an upload fails -> flag stays unset so migration retries', async () => {
  const userId = 'user_test_failure';
  const migrationKey = `${USER_PREFERENCE_STORAGE_KEY}_migrated_${userId}`;
  const storageKey = `${USER_PREFERENCE_STORAGE_KEY}_${userId}`;

  // Flag is NOT set
  assert.equal(localStorage.getItem(migrationKey), null);

  // Local storage has A and B
  const localList = [
    { id: 'prefA', category: 'communication', preferenceStatement: 'Pref A statement', updatedAt: '2026-09-01T10:00:00Z' },
    { id: 'prefB', category: 'scheduling', preferenceStatement: 'Pref B statement', updatedAt: '2026-09-01T10:00:00Z' }
  ];
  mockStorage.set(storageKey, JSON.stringify(localList));

  const fakeFirestore = {
    getDocs: async () => [],
    setDoc: async (id) => {
      if (id === 'prefB') {
        throw new Error('Simulated network error on prefB upload');
      }
      return Promise.resolve();
    }
  };

  const result = await loadUserPreferences(userId, null, { firestore: fakeFirestore });

  // Local preferences are still preserved in return value during the current session
  assert.equal(result.length, 2);

  // Migration flag MUST remain unset because an upload failed
  assert.equal(localStorage.getItem(migrationKey), null);
});
