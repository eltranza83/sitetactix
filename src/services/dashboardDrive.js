import { fetchProjectDashboardData } from './sheetsDataService.js';
import {
  findSpreadsheetInFolder,
  listPhotosInPhase,
  uploadPhotoToPhaseFolder
} from './googleDrive.js';

export function buildDashboardPhotoFileName(originalName, now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `Photo_${timestamp}_${originalName}`;
}

/**
 * Contractor lookup: phases whose payee, phase or category contains the search text, or (new-layout Sheets)
 * whose contracts' Sub or Company does, so "Enrique" and "Lucen" both find "Enrique Vallejo (Lucen LLC)".
 */
export function filterContractorSuggestions(subcontractors, searchTerm) {
  if (!Array.isArray(subcontractors)) return [];
  const query = String(searchTerm || '').toLowerCase();
  return subcontractors.filter(sub => {
    if (!sub) return false;
    const names = [
      sub.payee,
      sub.phase,
      sub.category,
      ...(Array.isArray(sub.contracts) ? sub.contracts.flatMap(c => [c?.sub, c?.company]) : [])
    ];
    return names.some(name => String(name || '').toLowerCase().includes(query));
  });
}

export function getDashboardStorageKeys(projectId) {
  return {
    spreadsheetId: `jobscan_sheet_id_${projectId}`,
    cachedDashboard: `jobscan_cached_dashboard_${projectId}`
  };
}

export function loadCachedDashboard(storage, projectId) {
  if (!storage || !projectId) return null;

  const { cachedDashboard } = getDashboardStorageKeys(projectId);
  const cached = storage.getItem(cachedDashboard);
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export function persistDashboardCache(storage, projectId, dashboardData) {
  if (!storage || !projectId || !dashboardData) return;
  const { cachedDashboard } = getDashboardStorageKeys(projectId);
  storage.setItem(cachedDashboard, JSON.stringify(dashboardData));
}

export function getCachedDashboardSpreadsheetId(storage, projectId) {
  if (!storage || !projectId) return null;
  const { spreadsheetId } = getDashboardStorageKeys(projectId);
  return storage.getItem(spreadsheetId);
}

export function persistDashboardSpreadsheetId(storage, projectId, spreadsheetId) {
  if (!storage || !projectId || !spreadsheetId) return;
  const { spreadsheetId: spreadsheetIdKey } = getDashboardStorageKeys(projectId);
  storage.setItem(spreadsheetIdKey, spreadsheetId);
}

export async function loadProjectDashboardFromFolder({
  accessToken,
  projectFolderId,
  cachedSpreadsheetId
}) {
  let spreadsheetId = cachedSpreadsheetId || null;

  if (!spreadsheetId) {
    const spreadsheet = await findSpreadsheetInFolder(accessToken, projectFolderId);
    if (!spreadsheet) {
      throw new Error("No spreadsheet found in your project folder. Please move your project spreadsheet (e.g. 'test project spreadsheet') into this folder.");
    }
    spreadsheetId = spreadsheet.id;
  }

  const data = await fetchProjectDashboardData(accessToken, spreadsheetId);
  return { spreadsheetId, data };
}

export async function listDashboardPhasePhotos({
  accessToken,
  projectFolderId,
  phase
}) {
  return await listPhotosInPhase(
    accessToken,
    projectFolderId,
    phase.category,
    phase.phase
  );
}

export async function uploadDashboardPhasePhoto({
  accessToken,
  projectFolderId,
  phase,
  file
}) {
  const fileName = buildDashboardPhotoFileName(file.name);

  await uploadPhotoToPhaseFolder(
    accessToken,
    projectFolderId,
    phase.category,
    phase.phase,
    fileName,
    file.type,
    file
  );

  return await listDashboardPhasePhotos({ accessToken, projectFolderId, phase });
}
