/**
 * Draft photos live in the phone's large app storage (IndexedDB), not in the small browser storage
 * (localStorage, about 5 MB per site), which only keeps the draft details. A photo stays in the
 * small storage until the large one confirms it saved it, so no photo is ever only in memory.
 * Without IndexedDB (private browsing, old browser) everything stays in the small storage, as before.
 */

export const DRAFT_PHOTO_FIELDS = ['mainImageBase64', 'secondaryImageBase64'];

const DB_NAME = 'sitetactix-drafts';
const STORE_NAME = 'photos';

const photoKey = (draftId, field) => `${draftId}:${field}`;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The IndexedDB store, or null when the browser has none or it cannot open. */
function openIndexedDbBackend() {
  if (typeof indexedDB === 'undefined') return null;
  let dbPromise = null;
  const db = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  };
  const run = async (mode, action) => {
    const store = (await db()).transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    return requestToPromise(action(store));
  };
  return {
    put: (key, value) => run('readwrite', store => store.put(value, key)),
    get: (key) => run('readonly', store => store.get(key)),
    delete: (key) => run('readwrite', store => store.delete(key)),
    keys: () => run('readonly', store => store.getAllKeys())
  };
}

let backend;
// Photos the large storage confirmed, by key: the exact text saved (so an edited photo is saved again)
const confirmed = new Map();
const saving = new Map();

function getBackend() {
  if (backend === undefined) backend = openIndexedDbBackend();
  return backend;
}

/** Tests: an in-memory store (or null for "no IndexedDB"); also forgets what was confirmed. */
export function setDraftPhotoBackend(nextBackend) {
  backend = nextBackend;
  confirmed.clear();
  saving.clear();
}

/** Photos still to load from the large storage for this draft (set when the draft was read from the small one). */
export function pendingDraftPhotos(draft) {
  return Array.isArray(draft?.storedPhotos) ? draft.storedPhotos : [];
}

/** A short reason a draft cannot sync yet because its photo has not loaded back (null when fine). */
export function draftPhotoProblem(draft) {
  return pendingDraftPhotos(draft).length > 0
    ? "This draft's photo is still loading on this phone. Try again in a moment."
    : null;
}

/**
 * What goes in the small storage: each photo the large storage confirmed is left out and named in
 * storedPhotos instead. A photo not confirmed yet stays inline, so it is never only in memory.
 */
export function draftsForSmallStorage(drafts) {
  return (Array.isArray(drafts) ? drafts : []).map(draft => {
    const stored = [];
    const copy = { ...draft };
    delete copy.storedPhotos;
    for (const field of DRAFT_PHOTO_FIELDS) {
      const value = draft[field];
      if (value) {
        if (confirmed.get(photoKey(draft.id, field)) === value) {
          stored.push(field);
          copy[field] = null;
        }
      } else if (pendingDraftPhotos(draft).includes(field)) {
        // Not loaded back yet: the photo is still in the large storage
        stored.push(field);
      }
    }
    if (stored.length > 0) copy.storedPhotos = stored;
    return copy;
  });
}

/**
 * Saves every photo the large storage does not have yet. onSaved runs after each one is confirmed,
 * so the small storage can then drop it. Returns a promise for tests.
 */
export function saveDraftPhotos(drafts, onSaved) {
  const store = getBackend();
  if (!store) return Promise.resolve();
  const jobs = [];
  for (const draft of (Array.isArray(drafts) ? drafts : [])) {
    for (const field of DRAFT_PHOTO_FIELDS) {
      const value = draft[field];
      const key = photoKey(draft.id, field);
      if (!value || confirmed.get(key) === value || saving.get(key) === value) continue;
      saving.set(key, value);
      jobs.push(store.put(key, value)
        .then(() => {
          if (saving.get(key) === value) saving.delete(key);
          confirmed.set(key, value);
          onSaved?.();
        })
        .catch(err => {
          if (saving.get(key) === value) saving.delete(key);
          console.warn('[draftPhotoStore] Could not save a draft photo to the large storage (kept in the small one):', err);
        }));
    }
  }
  return Promise.all(jobs);
}

/**
 * Puts back the photos drafts left in the large storage. A photo that could not be read (an error)
 * stays pending, so the draft still cannot sync; a photo that is not there at all is reported in
 * missingPhotos on the draft instead of silently syncing without it.
 */
export async function restoreDraftPhotos(drafts) {
  const store = getBackend();
  const list = Array.isArray(drafts) ? drafts : [];
  if (!store) return list;
  const restored = [];
  for (const draft of list) {
    const pending = pendingDraftPhotos(draft);
    if (pending.length === 0) {
      restored.push(draft);
      continue;
    }
    const next = { ...draft };
    const stillPending = [];
    const missing = [];
    for (const field of pending) {
      const key = photoKey(draft.id, field);
      try {
        const value = await store.get(key);
        if (value) {
          confirmed.set(key, value);
          next[field] = value;
        } else {
          missing.push(field);
        }
      } catch (err) {
        console.warn('[draftPhotoStore] Could not load a draft photo:', err);
        stillPending.push(field);
      }
    }
    delete next.storedPhotos;
    if (stillPending.length > 0) next.storedPhotos = stillPending;
    if (missing.length > 0) next.missingPhotos = missing;
    restored.push(next);
  }
  return restored;
}

/** Removes photos of drafts that are gone (synced or deleted) and photos a draft no longer has. */
export async function removeUnusedDraftPhotos(drafts) {
  const store = getBackend();
  if (!store) return;
  const keep = new Set();
  for (const draft of (Array.isArray(drafts) ? drafts : [])) {
    for (const field of DRAFT_PHOTO_FIELDS) {
      if (draft[field] || pendingDraftPhotos(draft).includes(field)) keep.add(photoKey(draft.id, field));
    }
  }
  try {
    for (const key of await store.keys()) {
      if (!keep.has(key) && !saving.has(key)) {
        await store.delete(key);
        confirmed.delete(key);
      }
    }
  } catch (err) {
    console.warn('[draftPhotoStore] Could not clean up draft photos:', err);
  }
}
