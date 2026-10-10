/**
 * Linking each project to its own Google Sheet, so sync and the Dashboard always use the same file.
 */

import { copyDriveFile } from './googleDrive.js';
import { clipReceiptLinkColumns, writeProjectInfo } from './sheetV2.js';

export const PREFERRED_SHEET_NAME = 'JobScan_Expense_Log';

/**
 * Decides which spreadsheet in the project folder is the project's Sheet.
 * - one spreadsheet: link it
 * - several, but exactly one has the standard name: link that one
 * - several otherwise: the owner picks (never guess between budget sheets)
 * - none: nothing to link yet
 */
export function chooseProjectSpreadsheet(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(c => c && c.id) : [];
  if (list.length === 0) return { status: 'none' };
  if (list.length === 1) return { status: 'linked', sheet: list[0] };
  const preferred = list.filter(c => c.name === PREFERRED_SHEET_NAME);
  if (preferred.length === 1) return { status: 'linked', sheet: preferred[0] };
  return { status: 'choose', candidates: list };
}

/** The project with its Sheet linked. */
export function linkSheetToProject(project, sheet) {
  return {
    ...project,
    spreadsheetId: sheet?.id || '',
    spreadsheetName: sheet?.name || ''
  };
}

/** When the project's Drive folder changes, its old Sheet link no longer applies. */
export function clearSheetLinkIfFolderChanged(project, newFolderId) {
  if (project.folderId === newFolderId) return project;
  return { ...project, spreadsheetId: '', spreadsheetName: '' };
}

/** The setup values shown in the project form besides the name (Project Info rows 3-9). */
export const EMPTY_PROJECT_DETAILS = {
  address: '',
  cityStateZip: '',
  scope: '',
  budgetBuild: '',
  lotCost: '',
  sqftTotal: '',
  sqftLiving: ''
};

/** Name of the Sheet copied from the template for a new project. */
export function templateCopyName(projectName) {
  return `${String(projectName || '').trim() || 'New Project'} – SiteTactix`;
}

/** Form values (strings) from Project Info values read from the Sheet. */
export function projectDetailsFromSheet(info) {
  if (!info) return { ...EMPTY_PROJECT_DETAILS };
  const amount = (value) => (Number(value) ? String(value) : '');
  return {
    address: String(info.address || ''),
    cityStateZip: String(info.cityStateZip || ''),
    scope: String(info.scope || ''),
    budgetBuild: amount(info.budgetBuild),
    lotCost: amount(info.lotCost),
    sqftTotal: amount(info.sqftTotal),
    sqftLiving: amount(info.sqftLiving)
  };
}

/** The Project Info values to write, from the project name and the form details. */
export function buildProjectInfoFromForm(projectName, details = {}) {
  return {
    name: String(projectName || '').trim(),
    address: String(details.address || '').trim(),
    cityStateZip: String(details.cityStateZip || '').trim(),
    scope: String(details.scope || '').trim(),
    budgetBuild: String(details.budgetBuild ?? '').trim(),
    lotCost: String(details.lotCost ?? '').trim(),
    sqftTotal: String(details.sqftTotal ?? '').trim(),
    sqftLiving: String(details.sqftLiving ?? '').trim()
  };
}

/** True when any Project Info value differs (amounts compared as numbers, text without outer spaces). */
export function projectInfoChanged(before, after) {
  if (!before) return true;
  const numeric = new Set(['budgetBuild', 'lotCost', 'sqftTotal', 'sqftLiving']);
  return ['name', 'address', 'cityStateZip', 'scope', 'budgetBuild', 'lotCost', 'sqftTotal', 'sqftLiving'].some(field => {
    if (numeric.has(field)) {
      const left = parseFloat(String(before[field] ?? '').replace(/[^0-9.-]/g, '')) || 0;
      const right = parseFloat(String(after?.[field] ?? '').replace(/[^0-9.-]/g, '')) || 0;
      return left !== right;
    }
    return String(before[field] ?? '').trim() !== String(after?.[field] ?? '').trim();
  });
}

/**
 * Makes the project's Sheet from the template: copies it into the lot folder and fills in Project Info.
 * Returns { sheet: { id, name }, infoWritten, infoError }. A failed Project Info write still keeps the copy.
 */
export async function createProjectSheetFromTemplate({ accessToken, templateId, folderId, projectName, info }) {
  const copy = await copyDriveFile(accessToken, templateId, {
    name: templateCopyName(projectName),
    parentId: folderId
  });
  const sheet = { id: copy.id, name: copy.name || templateCopyName(projectName) };
  let infoError = null;
  try {
    await writeProjectInfo(accessToken, copy.id, info);
  } catch (err) {
    infoError = err;
  }
  // Long receipt links stay inside their cells (a failure here never stops the project being made)
  const { ok: linksClipped } = await clipReceiptLinkColumns(accessToken, copy.id);
  return { sheet, infoWritten: !infoError, infoError, linksClipped };
}
