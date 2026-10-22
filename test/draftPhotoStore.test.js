// v1.14.13: draft photos live in the phone's large storage (IndexedDB); the small storage
// (localStorage, ~5 MB) keeps only draft details. Real appStorage + draftPhotoStore code, with an
// in-memory stand-in for IndexedDB and a small storage that enforces a size limit like a phone.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function createLimitedStorage(limitChars = Infinity) {
  const store = new Map();
  const size = () => [...store.values()].reduce((sum, v) => sum + v.length, 0);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      const after = size() - (store.get(key)?.length || 0) + text.length;
      if (after > limitChars) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(key, text);
    },
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    size
  };
}

function createMemoryBackend({ failPuts = false, failGets = false } = {}) {
  const data = new Map();
  return {
    data,
    put: async (key, value) => { if (failPuts) throw new Error('disk error'); data.set(key, value); },
    get: async (key) => { if (failGets) throw new Error('disk error'); return data.get(key); },
    delete: async (key) => { data.delete(key); },
    keys: async () => [...data.keys()]
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const photo = (n, chars = 1000) => `data:image/jpeg;base64,${String(n).repeat(chars)}`;
const draft = (id, main, extra = {}) => ({ id, metadata: { vendor: 'Home Depot', amount: 10 }, mainImageBase64: main, secondaryImageBase64: null, ...extra });

globalThis.localStorage = createLimitedStorage();
globalThis.sessionStorage = createLimitedStorage();
const appStorage = await import('../src/services/appStorage.js');
const photos = await import('../src/services/draftPhotoStore.js');
const STAGED = appStorage.APP_STORAGE_KEYS.stagedItems;
const smallDrafts = () => JSON.parse(localStorage.getItem(STAGED) || '[]');

describe('draft photos move to the large storage', () => {
  let backend;

  beforeEach(() => {
    globalThis.localStorage = createLimitedStorage();
    backend = createMemoryBackend();
    photos.setDraftPhotoBackend(backend);
  });

  test('a new draft keeps its photo in the small storage until the large one has it, then drops it', async () => {
    const drafts = [draft('d1', photo(1))];
    appStorage.persistStagedItems(drafts);
    assert.equal(smallDrafts()[0].mainImageBase64, photo(1), 'never only in memory');

    await flush();
    assert.equal(backend.data.get('d1:mainImageBase64'), photo(1));
    assert.equal(smallDrafts()[0].mainImageBase64, null);
    assert.deepEqual(smallDrafts()[0].storedPhotos, ['mainImageBase64']);
  });

  test('after the app reopens, the photo is put back', async () => {
    appStorage.persistStagedItems([draft('d1', photo(1))]);
    await flush();

    const reopened = appStorage.loadStoredAppState().stagedItems;
    assert.equal(reopened[0].mainImageBase64, null);
    assert.match(photos.draftPhotoProblem(reopened[0]), /still loading/);
    const restored = await photos.restoreDraftPhotos(reopened);
    assert.equal(restored[0].mainImageBase64, photo(1));
    assert.equal(photos.draftPhotoProblem(restored[0]), null);
  });

  test('20 receipts with ~400 KB photos fit (the small storage alone holds about a dozen)', async () => {
    globalThis.localStorage = createLimitedStorage(5_000_000);
    let drafts = [];
    let fullWarnings = 0;
    for (let i = 0; i < 20; i++) {
      drafts = [draft(`d${i}`, photo(i % 10, 400_000)), ...drafts];
      try {
        appStorage.persistStagedItems(drafts);
      } catch {
        fullWarnings++;
      }
      await flush();
    }
    assert.equal(fullWarnings, 0);
    assert.equal(smallDrafts().length, 20);
    assert.ok(localStorage.size() < 100_000, `small storage holds only details (${localStorage.size()} chars)`);
    assert.equal(backend.data.size, 20);
  });

  test('if the large storage cannot save, the photo stays in the small one (never lost)', async () => {
    photos.setDraftPhotoBackend(createMemoryBackend({ failPuts: true }));
    appStorage.persistStagedItems([draft('d1', photo(1))]);
    await flush();
    assert.equal(smallDrafts()[0].mainImageBase64, photo(1));
    assert.equal(smallDrafts()[0].storedPhotos, undefined);
  });

  test('without IndexedDB (private browsing) everything stays in the small storage, as before', async () => {
    photos.setDraftPhotoBackend(null);
    appStorage.persistStagedItems([draft('d1', photo(1))]);
    await flush();
    assert.equal(smallDrafts()[0].mainImageBase64, photo(1));
  });

  test('an edited photo is saved again', async () => {
    appStorage.persistStagedItems([draft('d1', photo(1))]);
    await flush();
    appStorage.persistStagedItems([draft('d1', photo(2))]);
    assert.equal(smallDrafts()[0].mainImageBase64, photo(2), 'new photo stays until confirmed');
    await flush();
    assert.equal(backend.data.get('d1:mainImageBase64'), photo(2));
    assert.equal(smallDrafts()[0].mainImageBase64, null);
  });

  test('photos of synced or deleted drafts are removed; photos still waiting to load back are kept', async () => {
    appStorage.persistStagedItems([draft('d1', photo(1)), draft('d2', photo(2))]);
    await flush();
    const notLoadedYet = { ...draft('d2', null), storedPhotos: ['mainImageBase64'] };
    await photos.removeUnusedDraftPhotos([notLoadedYet]);
    assert.equal(backend.data.has('d1:mainImageBase64'), false);
    assert.equal(backend.data.has('d2:mainImageBase64'), true);
  });

  test('a photo that cannot be read keeps the draft from syncing; a photo that is gone is reported', async () => {
    const pending = [{ ...draft('d1', null), storedPhotos: ['mainImageBase64'] }];

    photos.setDraftPhotoBackend(createMemoryBackend({ failGets: true }));
    const afterError = await photos.restoreDraftPhotos(pending);
    assert.match(photos.draftPhotoProblem(afterError[0]), /still loading/);

    photos.setDraftPhotoBackend(createMemoryBackend());
    const gone = await photos.restoreDraftPhotos(pending);
    assert.equal(photos.draftPhotoProblem(gone[0]), null);
    assert.deepEqual(gone[0].missingPhotos, ['mainImageBase64']);
  });
});

test('History keeps only the newest 1,000 entries', () => {
  globalThis.localStorage = createLimitedStorage();
  const history = Array.from({ length: 1500 }, (_, i) => ({ id: `h${i}` }));
  appStorage.persistHistory(history);
  const saved = JSON.parse(localStorage.getItem(appStorage.APP_STORAGE_KEYS.history));
  assert.equal(saved.length, appStorage.HISTORY_LIMIT);
  assert.equal(saved[0].id, 'h0');
});
