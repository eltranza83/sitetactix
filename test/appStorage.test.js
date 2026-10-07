import assert from 'node:assert/strict';
import test from 'node:test';

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

globalThis.localStorage = createLocalStorageMock();
globalThis.sessionStorage = createLocalStorageMock();

const {
  APP_STORAGE_KEYS,
  clearGoogleIdentity,
  clearGoogleSession,
  getStoredBoolean,
  getStoredJson,
  loadInitialInviteState,
  loadStoredAppState,
  persistActiveProject,
  persistGoogleToken,
  persistGoogleUser,
  setStoredBoolean,
  setStoredJson
} = await import('../src/services/appStorage.js');
const { DEFAULT_GOOGLE_CLIENT_ID } = await import('../src/config/appConfig.js');

test.beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('JSON helpers return fallbacks for missing or invalid values', () => {
  assert.deepEqual(getStoredJson('missing', { ok: true }), { ok: true });

  localStorage.setItem('bad-json', '{nope');
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(getStoredJson('bad-json', []), []);
  } finally {
    console.error = originalConsoleError;
  }

  setStoredJson('valid-json', { value: 42 });
  assert.deepEqual(getStoredJson('valid-json', null), { value: 42 });
});

test('boolean helpers persist true and false strings', () => {
  assert.equal(getStoredBoolean('flag'), false);
  setStoredBoolean('flag', true);
  assert.equal(localStorage.getItem('flag'), 'true');
  assert.equal(getStoredBoolean('flag'), true);
  setStoredBoolean('flag', false);
  assert.equal(localStorage.getItem('flag'), 'false');
});

test('loadStoredAppState builds selected folder and arrays from local storage', () => {
  localStorage.setItem(APP_STORAGE_KEYS.folderId, 'folder-1');
  localStorage.setItem(APP_STORAGE_KEYS.folderName, 'Project Folder');
  setStoredJson(APP_STORAGE_KEYS.projects, [{ id: 'p1' }]);
  setStoredJson(APP_STORAGE_KEYS.history, [{ id: 'h1' }]);
  setStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads, true);

  const state = loadStoredAppState();

  assert.equal(state.googleToken, null);
  assert.deepEqual(state.selectedFolder, { id: 'folder-1', name: 'Project Folder' });
  assert.deepEqual(state.projects, [{ id: 'p1' }]);
  assert.deepEqual(state.history, [{ id: 'h1' }]);
  assert.equal(state.hasUnprocessedUploads, true);
});

test('loadStoredAppState purges legacy browser secrets and sanitizes projects', () => {
  localStorage.setItem(APP_STORAGE_KEYS.legacyGeminiKey, 'old-gemini-key');
  localStorage.setItem(APP_STORAGE_KEYS.googleToken, 'persisted-drive-token');
  setStoredJson(APP_STORAGE_KEYS.projects, [{
    id: 'p1',
    appsScriptUrl: 'https://script.example',
    appsScriptSecret: 'old-secret'
  }]);

  const state = loadStoredAppState();

  assert.deepEqual(state.projects, [{ id: 'p1' }]);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.legacyGeminiKey), null);
  assert.equal(state.googleToken, 'persisted-drive-token');
});

test('persistActiveProject stores and clears project folder state', () => {
  persistActiveProject({
    id: 'project-1',
    name: 'Lot 1',
    folderId: 'folder-1',
    folderName: 'Lot 1 Folder'
  });

  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.activeProjectId), 'project-1');
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.folderId), 'folder-1');
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.folderName), 'Lot 1 Folder');

  persistActiveProject(null);

  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.activeProject), 'null');
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.activeProjectId), null);
});

test('invite state follows the authorized Google user email', () => {
  persistGoogleUser({ email: 'builder@example.com' });
  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'builder@example.com');

  assert.equal(loadInitialInviteState(), true);

  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'other@example.com');
  assert.equal(loadInitialInviteState(), false);
});

test('Google session clearing removes identity and linked project session values', () => {
  persistGoogleToken('token-1');
  persistGoogleUser({ email: 'builder@example.com' });
  persistActiveProject({
    id: 'project-1',
    name: 'Lot 1',
    folderId: 'folder-1',
    folderName: 'Lot 1 Folder'
  });
  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'builder@example.com');
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');

  clearGoogleIdentity();
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleToken), null);
  assert.deepEqual(getStoredJson(APP_STORAGE_KEYS.googleUser), { email: 'builder@example.com' });
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.folderId), 'folder-1');

  persistGoogleToken('token-2');
  persistGoogleUser({ email: 'builder@example.com' });
  clearGoogleSession();

  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleToken), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleUser), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.folderId), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.activeProject), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.invited), null);
});

test('loadStoredAppState always uses the built-in Google sign-in ID and drops an old saved copy', () => {
  localStorage.setItem(APP_STORAGE_KEYS.legacyGoogleClientId, 'old-client-id.apps.googleusercontent.com');

  const state = loadStoredAppState();

  assert.equal(state.googleClientId, DEFAULT_GOOGLE_CLIENT_ID);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.legacyGoogleClientId), null);
});
