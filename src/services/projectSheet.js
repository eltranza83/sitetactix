/**
 * Linking each project to its own Google Sheet, so sync and the Dashboard always use the same file.
 */

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
