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
  getStoredJson,
  loadInitialInviteState,
  loadStoredAppState,
  persistActiveProject,
  persistGoogleToken,
  persistGoogleUser,
  persistProjects,
} = await import('../src/services/appStorage.js');

const { isBuiltInAdmin } = await import('../src/config/appConfig.js');
const { resolveUserActiveProject } = await import('../src/services/projectService.js');

test.beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('1. Sign in -> reload page -> remain signed in', () => {
  const signedInUser = {
    email: 'acepeda83@gmail.com',
    name: 'Ace',
    firebaseUid: 'uid-ace-123'
  };
  persistGoogleUser(signedInUser);
  persistGoogleToken('valid-oauth-token-123');
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');
  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'acepeda83@gmail.com');

  // Simulate full page reload
  const reloadedState = loadStoredAppState();
  assert.equal(reloadedState.googleToken, 'valid-oauth-token-123');
  assert.deepEqual(reloadedState.googleUser, signedInUser);
  assert.equal(loadInitialInviteState(), true, 'User remains invited and authorized immediately on reload');
});

test('2. Sign in -> background app (memory eviction) -> return -> remain signed in', () => {
  const adminUser = {
    email: 'adepecgroup@gmail.com',
    name: 'Admin',
    firebaseUid: 'uid-admin-root'
  };
  persistGoogleUser(adminUser);
  persistGoogleToken('token-background-test');

  // Simulate mobile OS evicting JS heap and reloading from storage
  const restoredState = loadStoredAppState();
  assert.deepEqual(restoredState.googleUser, adminUser);
  assert.equal(restoredState.googleToken, 'token-background-test');
  assert.equal(isBuiltInAdmin(restoredState.googleUser.email), true);
  assert.equal(loadInitialInviteState(), true);
});

test('3. Sign in -> close/reopen browser/PWA -> remain signed in', () => {
  persistGoogleUser({ email: 'superintendent@adepec.com', name: 'Super' });
  persistGoogleToken('persisted-token');
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');
  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'superintendent@adepec.com');

  // Simulate reopened session
  const reopenedState = loadStoredAppState();
  assert.equal(reopenedState.googleToken, 'persisted-token');
  assert.equal(reopenedState.googleUser.email, 'superintendent@adepec.com');
  assert.equal(loadInitialInviteState(), true);
});

test('4. Expire/invalidate Google Drive token -> SiteTactix user remains authenticated', () => {
  const activeUser = {
    email: 'acepeda83@gmail.com',
    name: 'Ace',
    firebaseUid: 'uid-ace-123'
  };
  persistGoogleUser(activeUser);
  persistGoogleToken('about-to-expire-token');
  persistActiveProject({ id: 'proj-lot-3', name: 'Lot 3 - Modern Farmhouse' });
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');

  // Token expires or 401 triggers clearGoogleIdentity
  clearGoogleIdentity();

  // Inspect storage: Drive token is removed, but User, Project, and Invite MUST remain intact!
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleToken), null);
  assert.deepEqual(getStoredJson(APP_STORAGE_KEYS.googleUser), activeUser, 'User identity must be preserved');
  assert.deepEqual(getStoredJson(APP_STORAGE_KEYS.activeProject), { id: 'proj-lot-3', name: 'Lot 3 - Modern Farmhouse' }, 'Active project must be preserved');
  assert.equal(loadInitialInviteState(), true, 'Invite gate must remain unlocked');
});

test('5. Expired Google token -> reconnect Google Drive -> Drive/Sheets access restored', () => {
  const activeUser = { email: 'acepeda83@gmail.com', name: 'Ace' };
  persistGoogleUser(activeUser);
  persistActiveProject({ id: 'proj-lot-3', name: 'Lot 3' });
  clearGoogleIdentity();

  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleToken), null);

  // User taps "Reconnect Google Drive" and obtains new token
  persistGoogleToken('fresh-reconnected-token-999');

  const refreshedState = loadStoredAppState();
  assert.equal(refreshedState.googleToken, 'fresh-reconnected-token-999');
  assert.deepEqual(refreshedState.googleUser, activeUser);
  assert.equal(refreshedState.activeProject.id, 'proj-lot-3');
});

test('6. Reload during Firebase Auth initialization -> no false InviteScreen flash', () => {
  // Stored state has user, but Firebase onAuthStateChanged has not yet resolved
  persistGoogleUser({ email: 'acepeda83@gmail.com' });
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');

  // App checks invite state synchronously on mount
  assert.equal(loadInitialInviteState(), true, 'Synchronous load prevents InviteScreen flash');
});

test('7. Multi-tenant boundary preservation between admin and standard invited user', () => {
  const adminEmail = 'adepecgroup@gmail.com';
  const standardEmail = 'acepeda83@gmail.com';

  assert.equal(isBuiltInAdmin(adminEmail), true);
  assert.equal(isBuiltInAdmin(standardEmail), false);

  const projects = [
    { id: 'proj-1', name: 'Admin Project', ownerEmail: adminEmail, members: [adminEmail] },
    { id: 'proj-2', name: 'Ace Project', ownerEmail: standardEmail, members: [standardEmail] }
  ];

  // Standard user should only resolve standard user project
  const aceActive = resolveUserActiveProject(projects, 'proj-2');
  assert.equal(aceActive.id, 'proj-2');
  assert.equal(aceActive.ownerEmail, standardEmail);
});

test('8. Explicit Sign Out -> actually signs user out and clears appropriate persisted state', () => {
  persistGoogleUser({ email: 'acepeda83@gmail.com' });
  persistGoogleToken('active-token');
  persistActiveProject({ id: 'proj-lot-3' });
  localStorage.setItem(APP_STORAGE_KEYS.invited, 'true');
  localStorage.setItem(APP_STORAGE_KEYS.authorizedEmail, 'acepeda83@gmail.com');

  // User clicks Sign Out
  clearGoogleSession();

  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleToken), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.googleUser), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.activeProject), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.invited), null);
  assert.equal(localStorage.getItem(APP_STORAGE_KEYS.authorizedEmail), null);
  assert.equal(loadInitialInviteState(), false, 'Signed out user is properly locked out');
});

