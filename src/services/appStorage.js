import { DEFAULT_GOOGLE_CLIENT_ID, isBuiltInAdmin } from '../config/appConfig.js';

export const APP_STORAGE_KEYS = {
  legacyGoogleClientId: 'sitetactix_google_client_id',
  legacyGeminiKey: 'jobscan_gemini_key',
  googleToken: 'jobscan_google_token',
  googleTokenIssuedAt: 'jobscan_google_token_time',
  googleUser: 'jobscan_google_user',
  folderId: 'jobscan_folder_id',
  folderName: 'jobscan_folder_name',
  projects: 'jobscan_projects',
  activeProject: 'jobscan_active_project',
  activeProjectId: 'jobscan_active_project_id',
  history: 'jobscan_history',
  stagedItems: 'jobscan_staged_items',
  hasUnprocessedUploads: 'jobscan_has_unprocessed_uploads',
  authorizedEmail: 'jobscan_authorized_email',
  invited: 'jobscan_invited',
};

export function getStoredJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse local storage value for ${key}:`, err);
    return fallback;
  }
}

export function setStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getStoredBoolean(key) {
  return localStorage.getItem(key) === 'true';
}

export function setStoredBoolean(key, value) {
  localStorage.setItem(key, value ? 'true' : 'false');
}

export function loadInitialInviteState() {
  if (localStorage.getItem(APP_STORAGE_KEYS.invited) === 'true') {
    return true;
  }
  const user = getStoredJson(APP_STORAGE_KEYS.googleUser, null);
  if (user?.email && isBuiltInAdmin(user.email)) {
    return true;
  }
  if (!user?.email) return false;
  return localStorage.getItem(APP_STORAGE_KEYS.authorizedEmail) === user.email;
}

export function loadStoredAppState() {
  localStorage.removeItem(APP_STORAGE_KEYS.legacyGeminiKey);
  // The Google sign-in ID always comes from the app itself; drop any old copy saved on the phone
  localStorage.removeItem(APP_STORAGE_KEYS.legacyGoogleClientId);
  const googleClientId = DEFAULT_GOOGLE_CLIENT_ID;
  const folderId = localStorage.getItem(APP_STORAGE_KEYS.folderId);
  const folderName = localStorage.getItem(APP_STORAGE_KEYS.folderName);

  const projects = sanitizeProjects(getStoredJson(APP_STORAGE_KEYS.projects, []));
  const activeProject = sanitizeProject(getStoredJson(APP_STORAGE_KEYS.activeProject, null));
  persistProjects(projects);
  if (activeProject) persistActiveProject(activeProject);

  return {
    googleClientId,
    googleToken: localStorage.getItem(APP_STORAGE_KEYS.googleToken) || null,
    googleUser: getStoredJson(APP_STORAGE_KEYS.googleUser, null),
    selectedFolder: folderId && folderName ? { id: folderId, name: folderName } : null,
    projects,
    activeProject,
    history: getStoredJson(APP_STORAGE_KEYS.history, []),
    stagedItems: getStoredJson(APP_STORAGE_KEYS.stagedItems, []),
    hasUnprocessedUploads: getStoredBoolean(APP_STORAGE_KEYS.hasUnprocessedUploads),
  };
}

export function persistGoogleToken(token) {
  if (token) {
    localStorage.setItem(APP_STORAGE_KEYS.googleToken, token);
    localStorage.setItem(APP_STORAGE_KEYS.googleTokenIssuedAt, String(Date.now()));
  } else {
    localStorage.removeItem(APP_STORAGE_KEYS.googleToken);
    localStorage.removeItem(APP_STORAGE_KEYS.googleTokenIssuedAt);
  }
}

export function persistGoogleUser(user) {
  setStoredJson(APP_STORAGE_KEYS.googleUser, user);
}

export function clearGoogleSession() {
  [
    APP_STORAGE_KEYS.googleToken,
    APP_STORAGE_KEYS.googleTokenIssuedAt,
    APP_STORAGE_KEYS.googleUser,
    APP_STORAGE_KEYS.folderId,
    APP_STORAGE_KEYS.folderName,
    APP_STORAGE_KEYS.activeProject,
    APP_STORAGE_KEYS.activeProjectId,
    APP_STORAGE_KEYS.authorizedEmail,
    APP_STORAGE_KEYS.invited,
  ].forEach((key) => localStorage.removeItem(key));
}

export function clearGoogleIdentity() {
  localStorage.removeItem(APP_STORAGE_KEYS.googleToken);
  localStorage.removeItem(APP_STORAGE_KEYS.googleTokenIssuedAt);
}

export function persistActiveProject(project) {
  if (!project) {
    localStorage.setItem(APP_STORAGE_KEYS.activeProject, 'null');
    localStorage.removeItem(APP_STORAGE_KEYS.activeProjectId);
    return;
  }

  const safeProject = sanitizeProject(project);
  setStoredJson(APP_STORAGE_KEYS.activeProject, safeProject);
  localStorage.setItem(APP_STORAGE_KEYS.activeProjectId, safeProject.id);
  localStorage.setItem(APP_STORAGE_KEYS.folderId, safeProject.folderId);
  localStorage.setItem(APP_STORAGE_KEYS.folderName, safeProject.folderName);
}

export function persistProjects(projects) {
  setStoredJson(APP_STORAGE_KEYS.projects, sanitizeProjects(projects));
}

export function sanitizeProject(project) {
  if (!project || typeof project !== 'object') return null;
  const { appsScriptUrl: _appsScriptUrl, appsScriptSecret: _appsScriptSecret, ...safeProject } = project;
  return safeProject;
}

export function sanitizeProjects(projects) {
  return Array.isArray(projects) ? projects.map(sanitizeProject).filter(Boolean) : [];
}

export function persistHistory(history) {
  setStoredJson(APP_STORAGE_KEYS.history, history);
}

export function persistStagedItems(stagedItems) {
  setStoredJson(APP_STORAGE_KEYS.stagedItems, stagedItems);
}
