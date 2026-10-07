import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseProjectSpreadsheet,
  linkSheetToProject,
  clearSheetLinkIfFolderChanged,
  PREFERRED_SHEET_NAME
} from '../src/services/projectSheet.js';
import { normalizeProjectRecord } from '../src/services/projectService.js';

describe('linking a project to its Google Sheet automatically', () => {
  test('one spreadsheet in the folder is linked without asking', () => {
    const result = chooseProjectSpreadsheet([{ id: 's1', name: 'Lot 3 Budget' }]);
    assert.deepEqual(result, { status: 'linked', sheet: { id: 's1', name: 'Lot 3 Budget' } });
  });

  test('several spreadsheets: the standard-named one is linked; otherwise the owner picks', () => {
    const withStandard = chooseProjectSpreadsheet([{ id: 'a', name: 'Backup copy' }, { id: 'b', name: PREFERRED_SHEET_NAME }]);
    assert.equal(withStandard.status, 'linked');
    assert.equal(withStandard.sheet.id, 'b');

    const ambiguous = chooseProjectSpreadsheet([{ id: 'a', name: 'Budget v1' }, { id: 'b', name: 'Budget v2' }]);
    assert.equal(ambiguous.status, 'choose');
    assert.equal(ambiguous.candidates.length, 2);
  });

  test('no spreadsheet yet means nothing to link', () => {
    assert.deepEqual(chooseProjectSpreadsheet([]), { status: 'none' });
    assert.deepEqual(chooseProjectSpreadsheet(undefined), { status: 'none' });
  });

  test('the link is kept on the project record', () => {
    const linked = linkSheetToProject({ id: 'lot_3', name: 'Lot 3', folderId: 'f1' }, { id: 's1', name: 'Lot 3 Budget' });
    assert.equal(linked.spreadsheetId, 's1');
    assert.equal(linked.spreadsheetName, 'Lot 3 Budget');
    const record = normalizeProjectRecord(linked, 'lot_3');
    assert.equal(record.spreadsheetId, 's1');
    assert.equal(record.spreadsheetName, 'Lot 3 Budget');
    assert.equal(normalizeProjectRecord({ name: 'Lot 9' }).spreadsheetId, '');
  });

  test('changing the project folder drops the old link so it re-links', () => {
    const project = { id: 'lot_3', folderId: 'f1', spreadsheetId: 's1', spreadsheetName: 'Old' };
    assert.equal(clearSheetLinkIfFolderChanged(project, 'f1').spreadsheetId, 's1');
    const moved = clearSheetLinkIfFolderChanged(project, 'f2');
    assert.equal(moved.spreadsheetId, '');
    assert.equal(moved.spreadsheetName, '');
  });

  test('the punch list never writes to the money Sheet', async () => {
    const { readFileSync } = await import('node:fs');
    const issues = readFileSync(new URL('../src/hooks/useIssues.js', import.meta.url), 'utf8');
    const sheets = readFileSync(new URL('../src/services/sheetsDataService.js', import.meta.url), 'utf8');
    assert.doesNotMatch(issues, /syncIssuesToSheet|spreadsheetId/);
    assert.doesNotMatch(sheets, /syncIssuesToSheet|'Issues'/);
  });
});

describe('folder picker shows the spreadsheets in a folder', () => {
  test('asks Drive for spreadsheets directly inside the folder, and copes with errors', async () => {
    const { listSpreadsheetsInFolder } = await import('../src/services/googleDrive.js');
    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    try {
      globalThis.fetch = async (url) => {
        seenUrl = decodeURIComponent(String(url));
        return { ok: true, json: async () => ({ files: [{ id: 's1', name: 'Lot 3 Budget' }] }) };
      };
      const sheets = await listSpreadsheetsInFolder('token', "lot's folder");
      assert.deepEqual(sheets, [{ id: 's1', name: 'Lot 3 Budget' }]);
      assert.match(seenUrl, /mimeType='application\/vnd\.google-apps\.spreadsheet'/);
      assert.ok(seenUrl.includes("'lot\\'s folder' in parents"), 'folder id is escaped for the Drive query');

      globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
      assert.deepEqual(await listSpreadsheetsInFolder('token', 'f1'), []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
